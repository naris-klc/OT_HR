'use client';

import React, { useEffect, useRef, useState } from 'react';
import { api, thaiDate, dayName, periodLabel, COMPANIES } from '@/lib/api.js';
import {
  HR_ASSIGNABLE_ROLES, PASSWORD_MIN_LENGTH, SELF_LOCKED_FIELDS,
  chosenPasswordPermission, dropsAnAdmin,
} from '@/lib/employees.js';
import { ACCOUNTING_SENSITIVE, FIELD_LABEL, rosterChanges } from '@/lib/rosterAudit.js';
import { parseCsv, toCsv } from '@/src/lib/csv.js';
// Pure config, no mongoose — the same resolution the accounting sheet uses, so
// the column showing which payroll somebody is on cannot disagree with the file
// they end up in.
import { companyOf } from '@/src/config/companies.js';
import { resolveBirthDateColumn, birthDatePreview, ORDER_LABEL } from '@/lib/birthDate.js';
import { Alert, Empty, Modal } from './common.jsx';
import Delegation from './Delegation.jsx';

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
  return (
    <>
      <div className="card">
        <div className="row">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              className={`btn ${section === s.key ? '' : 'ghost'}`}
              onClick={() => setSection(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {section === 'departments' && <Departments />}
      {section === 'employees' && <Employees user={user} />}
      {section === 'holidays' && <Holidays />}
      {section === 'policy' && <Policy user={user} />}
      {section === 'delegation' && <Delegation user={user} scope="all" />}
      {section === 'rosterAudit' && <RosterAudit />}
    </>
  );
}

// ── departments ─────────────────────────────────────────────────────────────

function Departments() {
  const [rows, setRows] = useState([]);
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState({ code: '', name: '', nameTh: '', monthlyCapHours: '', weeklyCapHours: '' });
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  async function load() {
    try {
      const [d, e] = await Promise.all([api.get('/departments?all=1'), api.get('/employees?all=1')]);
      setRows(d.departments);
      setPeople(e.employees);
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    try {
      await api.post('/departments', form);
      setForm({ code: '', name: '', nameTh: '', monthlyCapHours: '', weeklyCapHours: '' });
      setOk('เพิ่มแผนกแล้ว');
      load();
    } catch (err) { setError(err.message); }
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
      <h2>แผนก</h2>
      <div className="hint">
        เพดานชั่วโมงกำหนดรายแผนกและไม่บังคับ — เว้นว่างหมายถึงไม่มีเพดาน ซึ่งไม่เหมือนกับเพดาน 0
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      <form className="row" onSubmit={create} style={{ marginBottom: 16 }}>
        <div className="field" style={{ maxWidth: 110 }}>
          <label>รหัส</label>
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
        </div>
        <div className="field">
          <label>ชื่อ (EN)</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="field">
          <label>ชื่อ (ไทย)</label>
          <input value={form.nameTh} onChange={(e) => setForm({ ...form, nameTh: e.target.value })} />
        </div>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>เพดาน ชม./เดือน</label>
          <input
            type="number" min="0" step="0.5" placeholder="ไม่กำหนด"
            value={form.monthlyCapHours}
            onChange={(e) => setForm({ ...form, monthlyCapHours: e.target.value })}
          />
        </div>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>เพดาน ชม./สัปดาห์</label>
          <input
            type="number" min="0" step="0.5" placeholder="ไม่กำหนด"
            value={form.weeklyCapHours}
            onChange={(e) => setForm({ ...form, weeklyCapHours: e.target.value })}
          />
        </div>
        <button className="btn">เพิ่มแผนก</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>รหัส</th><th>ชื่อแผนก</th><th>หัวหน้างาน</th>
              <th className="num">จำนวนคน</th>
              <th>เพดาน ชม./เดือน</th>
              <th>เพดาน ชม./สัปดาห์</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d._id}>
                <td>{d.code}</td>
                <td>{d.nameTh || d.name}</td>
                <td>
                  <select
                    value={d.manager?._id || ''}
                    onChange={(e) => update(d._id, { manager: e.target.value })}
                  >
                    <option value="">— ไม่กำหนด —</option>
                    {people.filter((p) => p.role === 'manager').map((p) => (
                      <option key={p._id} value={p._id}>{p.name} ({p.code})</option>
                    ))}
                  </select>
                </td>
                <td className="num">{d.headcount}</td>
                {/* Blank is no ceiling; 0 is a ceiling of zero. The field
                    sends whatever was typed and `capHoursFrom` on the server
                    keeps the two apart. */}
                <td>
                  <input
                    type="number" min="0" step="0.5" placeholder="ไม่กำหนด"
                    defaultValue={d.monthlyCapHours ?? ''}
                    style={{ width: 110 }}
                    onBlur={(e) => update(d._id, { monthlyCapHours: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number" min="0" step="0.5" placeholder="ไม่กำหนด"
                    defaultValue={d.weeklyCapHours ?? ''}
                    style={{ width: 110 }}
                    onBlur={(e) => update(d._id, { weeklyCapHours: e.target.value })}
                  />
                </td>
                <td>
                  <button className="btn ghost sm" onClick={() => update(d._id, { active: !d.active })}>
                    {d.active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── employees ───────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: 'employee', label: 'พนักงาน' },
  { value: 'manager', label: 'หัวหน้างาน' },
  { value: 'hr', label: 'ฝ่ายบุคคล' },
  { value: 'admin', label: 'ผู้ดูแลระบบ' },
];

const BLANK = {
  // `email` is on the model and on the create route, and was missing from this
  // form alone — so a person added one at a time arrived without one and had to
  // be edited straight afterwards to get it, while the same person imported from
  // CSV arrived complete.
  code: '', name: '', email: '', position: '', birthDate: '', department: '', role: 'employee',
  company: '',
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
    load();
  }

  /**
   * Save one or more fields on a row.
   *
   * The response is read rather than discarded, because two things can happen
   * on the way through that the roster table itself would not show:
   *
   *   recomputed  — a moved วันเกิด replays that person's ใบ ที่ยังไม่อนุมัติ,
   *                 since the day types they were computed under have changed.
   *                 A count of what moved belongs on screen; silently
   *                 restating somebody's pending hours does not.
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
      <div className="hint">
        เพิ่มทีละคน หรือนำเข้าเป็นไฟล์ CSV — รองรับทั้งสองแบบ จึงไม่ต้องรอคำตอบว่า HR จะส่งรายชื่อมาแบบไหน
        · ช่อง “บริษัท” ระบุว่าพนักงานคนนี้อยู่ในบัญชีเงินเดือนของบริษัทใด
        เว้นว่างได้ ระบบจะเดาจากรหัส (PM… = ไพรมัส, THT… = เดมเทค)
        · “วันเกิด” ไม่บังคับ และแก้ไขได้จากหน้านี้เท่านั้น —
        พนักงานเห็นได้ในหน้าข้อมูลส่วนตัวแต่แก้เองไม่ได้
        · ในไฟล์ CSV ให้ใช้ YYYY-MM-DD เป็น ค.ศ. (เช่น 1998-03-05) —
        แต่ถ้าเปิดไฟล์ด้วย Excel แล้วกดบันทึกทับ Excel จะเขียนคอลัมน์วันเกิดใหม่
        เป็น DD/MM/YYYY หรือ MM/DD/YYYY ตามการตั้งค่าของเครื่องนั้น
        ค่าอย่าง 05/03/1998 จึงเป็นได้ทั้ง 5 มีนาคม และ 3 พฤษภาคม
        ระบบอ่านได้ทั้ง YYYY-MM-DD และ DD/MM/YYYY และจะแสดงผลการตีความให้ตรวจก่อนกดยืนยันนำเข้า
        โปรดอ่านตัวอย่างนั้นให้ครบก่อนยืนยัน — ถ้าตีความไม่ได้แน่ชัด ระบบจะไม่นำเข้าทั้งไฟล์แทนที่จะเดา
        {/* Said here as well as on the dialogs, because it is the change most
            likely to be read as a bug: the password field people used to fill
            in is gone. */}
        · บัญชีที่สร้างจากหน้านี้ ระบบจะสุ่มรหัสผ่านชั่วคราวให้เอง
        แสดงบนจอครั้งเดียวให้ HR จดไปแจ้งพนักงาน
        และบังคับให้ตั้งรหัสผ่านของตัวเองเมื่อเข้าระบบครั้งแรก
        · การเพิ่มทีละคนเลือก “ตั้งเอง” ได้ถ้าต้องบอกรหัสกับพนักงานตรงนั้นเลย
        แต่อย่าใช้รูปแบบเดียวกันกับทุกคน และตั้งให้ไม่มีรหัสพนักงานอยู่ในนั้น
        (ระบบไม่รับ เพราะรหัสพนักงานพิมพ์อยู่บนใบ OT ทุกใบและในไฟล์ที่ส่งบัญชี)
        — ไฟล์ CSV ตั้งเองไม่ได้ ไม่ต้องมีคอลัมน์รหัสผ่าน ถ้ามีระบบจะไม่ใช้ค่านั้น
        {/* Said plainly, because the alternative is HR discovering it as a 403.
            Both limits are enforced on the server (lib/employees.js); this is
            the sentence that stops somebody looking for a button that is not
            there. */}
        {!isAdmin && ' · บทบาท “ผู้ดูแลระบบ” ตั้งได้โดยผู้ดูแลระบบเท่านั้น'}
        {!isAdmin && ' · “รหัสพนักงาน” ของคนที่มีอยู่แล้วแก้ได้โดยผู้ดูแลระบบเท่านั้น '
          + 'เพราะผูกกับการเข้าสู่ระบบและใบเก่า — แจ้งผู้ดูแลระบบพร้อมเหตุผล'}
        {/* ระบบไม่เก็บรหัสผ่านแบบอ่านได้: hashed one way, so there is nothing to
            show. The recovery path is the button on the row, and saying so here
            is what stops the question being asked. */}
        {' '}· ระบบเก็บรหัสผ่านแบบเข้ารหัสทางเดียว จึงไม่มีหน้าใดแสดงรหัสผ่านเดิมได้
        {' '}หากพนักงานลืม ให้ใช้ปุ่ม “ตั้งรหัสใหม่” ในตาราง
        {' '}· ทุกการแก้ไขถูกบันทึกไว้ว่าใครแก้ ฟิลด์ไหน ค่าเดิมเป็นอะไร เมื่อไหร่
        {' '}(ดูรายคนได้ที่ปุ่ม “ดูประวัติ” · ดูรวมทุกคนได้ที่แท็บ “ประวัติการแก้ทะเบียน”)
        {/* The table is a table again, and the form above it is gone. Both the
            row that does not exist yet and the row being corrected go through a
            dialog, which is the only place there is room to say what a field
            does before it is filled in and why another one is greyed out. */}
        {' '}· เพิ่มทีละคนได้ที่ปุ่ม “เพิ่มพนักงาน” ด้านล่าง
        {' '}· แก้ไขข้อมูลของคนที่มีอยู่แล้วได้ที่ปุ่ม “แก้ไข” ในแต่ละแถว
      </div>
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
                ? ` คำนวณใบที่ยังไม่อนุมัติใหม่ ${saved.recomputed.updated} รายการ`
                : ' ไม่มีใบที่ยังไม่อนุมัติให้คำนวณใหม่'}
              {' '}· ใบที่อนุมัติแล้วไม่ถูกแตะต้อง
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
        <Alert kind={result.auditUnlogged || result.errors?.length || result.warnings?.length ? 'warn' : 'ok'}>
          นำเข้าใหม่ {result.created} คน · ปรับปรุง {result.updated} คน
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
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>รหัส</th><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>วันเกิด</th><th>แผนก</th>
              <th>บทบาท</th><th>บริษัท</th><th>สถานะ</th><th>จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p._id}>
                <td style={{ whiteSpace: 'nowrap' }}>{p.code}</td>
                <td>{p.name}</td>
                <td>{p.position || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                {/* Shown as text like everything else. HR and Admin are the only
                    people who reach this screen, and `maySeePersonalDetails` on the
                    server is what decides they may be sent it at all. */}
                <td style={{ whiteSpace: 'nowrap' }}>
                  {p.birthDate
                    ? thaiDate(p.birthDate)
                    : <span style={{ color: 'var(--muted)' }}>— ยังไม่มี —</span>}
                </td>
                <td>{p.department ? (p.department.nameTh || p.department.name) : '—'}</td>
                <td>{ROLE_LABEL[p.role] || p.role}</td>
                {/* An unset company is not "no company" — the sheet falls back
                    to the code prefix and files them somewhere regardless. The
                    column says which, and that it was guessed, because that is
                    the difference between a blank worth fixing and one that is
                    already behaving correctly. */}
                <td style={{ whiteSpace: 'nowrap' }}>
                  {p.company ? companyName(p.company) : (
                    <span style={{ color: 'var(--muted)' }}>
                      {companyName(companyOf(p))} · เดาจากรหัส
                    </span>
                  )}
                </td>
                <td>{p.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</td>
                <td>
                  <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    {/* Opens for every row, including one this person may not
                        change: the dialog is where the reason is written, and a
                        dead button explains nothing. */}
                    <button className="btn ghost sm" onClick={() => setEditing(p)}>
                      {mayEdit(p) ? 'แก้ไข' : 'ดูข้อมูล'}
                    </button>
                    {/* ลืมรหัสผ่าน has no self-service path — no email is on file
                        for most of the roster — so this is the whole of the
                        recovery story, and it stays on the row rather than
                        behind an edit dialog somebody has to open for it. */}
                    <button
                      className="btn ghost sm"
                      onClick={() => setResetting(p)}
                      disabled={!mayEdit(p)}
                      title={mayEdit(p) ? 'ตั้งรหัสผ่านใหม่ให้พนักงานคนนี้' : 'บัญชีผู้ดูแลระบบตั้งรหัสใหม่ได้โดยผู้ดูแลระบบเท่านั้น'}
                    >
                      ตั้งรหัสใหม่
                    </button>
                    <button
                      className="btn ghost sm"
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
  const dirty = Object.keys(BLANK).some((k) => form[k] !== BLANK[k]);

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
          </div>
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
  const isSelf = String(user?._id ?? '') === String(employee._id ?? '');
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

  return (
    <Alert kind="ok">
      <strong>รหัสผ่านชั่วคราวของ {rows.length} บัญชีที่เพิ่งสร้าง</strong>
      {' '}— <strong>แสดงเพียงครั้งเดียว</strong> ออกจากหน้านี้แล้วดูซ้ำไม่ได้
      {' '}ถ้าพลาดต้องตั้งรหัสใหม่ทีละคน

      <div className="row" style={{ marginTop: 10, marginBottom: 4 }}>
        <button className="btn" onClick={copy}>คัดลอกทั้งตาราง</button>
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
        <table>
          <thead>
            <tr>{ISSUED_HEADERS.map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code}>
                <td style={{ whiteSpace: 'nowrap' }}>{row.code}</td>
                <td>{row.name}</td>
                <td style={{ fontFamily: 'var(--mono, monospace)', whiteSpace: 'nowrap' }}>
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

/**
 * A labelled control, with the sentence that explains it.
 *
 * TWO PLACES FOR THAT SENTENCE, because it is answering two different
 * questions.
 *
 * `note` stays on screen. It is for a control somebody cannot use: the reason
 * has to arrive before they try, not after they have clicked at a grey box and
 * gone looking for whoever maintains this.
 *
 * `tip` is the same kind of sentence for a control that works, and it waits
 * behind the (?) beside the label. Stacked under every field these were a wall
 * of grey taller than the form — and a wall of grey is read as decoration, so
 * the one sentence that mattered got skipped along with the rest. Hover gives
 * it through `title`, a click opens it in place; nothing is shortened or
 * dropped either way.
 */
function Field({ label, note, tip, children, style }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field" style={style}>
      <div className="field-head">
        <label>{label}</label>
        {tip && <TipButton text={tip} of={label} open={open} onToggle={() => setOpen((v) => !v)} />}
      </div>
      {children}
      {note && <div className="field-note">{note}</div>}
      {tip && open && <div className="field-note">{tip}</div>}
    </div>
  );
}

/**
 * The (?) that holds a sentence until it is asked for.
 *
 * A real <button>, not a styled span: it is reached by Tab, answers Enter and
 * Space, and says whether it is open — the sentence behind it is the only
 * explanation of the field, so a pointer must not be the one way to it.
 */
function TipButton({ text, of, open, onToggle }) {
  return (
    <button
      type="button"
      className={open ? 'tip-btn on' : 'tip-btn'}
      // Hover, for the reader who is not going to click anything.
      title={text}
      aria-expanded={open}
      aria-label={`คำอธิบายของ ${of}`}
      onClick={onToggle}
    >
      ?
    </button>
  );
}

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
  const [who, setWho] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/employees?all=1'), api.get('/departments?all=1')])
      .then(([e, d]) => { setPeople(e.employees); setDepts(d.departments); })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    setRecords(null);
    api.get(`/employees/audit${who ? `?employee=${who}` : ''}`)
      .then((res) => { setRecords(res.records); setHasMore(res.hasMore); setError(''); })
      .catch((err) => setError(err.message));
  }, [who]);

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

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="field" style={{ maxWidth: 320 }}>
          <label>กรองตามพนักงาน</label>
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">— ทุกคน —</option>
            {people.map((p) => (
              <option key={p._id} value={p._id}>{p.code} · {p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {hasMore && (
        <Alert kind="warn">
          รายการยาวกว่าที่แสดงได้ — หน้านี้แสดงเฉพาะรายการล่าสุด
          {' '}เลือกพนักงานรายคนเพื่อดูประวัติของคนนั้นให้ครบขึ้น
        </Alert>
      )}
      {!records && !error && <Empty>กำลังโหลด…</Empty>}
      {records && (
        <TrailList
          records={records}
          depts={depts}
          withWho
          empty={who
            ? 'ยังไม่มีการแก้ไขที่บันทึกไว้สำหรับคนนี้'
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

  if (password) {
    return (
      <Modal
        title="รหัสผ่านชั่วคราว"
        subtitle={`${employee.code} · ${employee.name}`}
        onClose={onClose}
        // The × and Escape ask first — and they ask about losing a password,
        // not about losing typing.
        dirty={!written}
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
          <button className="btn" onClick={copy}>คัดลอกรหัสผ่าน</button>
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
  const [form, setForm] = useState({ date: '', name: '' });
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  async function load() {
    try { setRows((await api.get(`/holidays?year=${year}`)).holidays); }
    catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, [year]);

  async function add(e) {
    e.preventDefault();
    try {
      const res = await api.post('/holidays', form);
      setForm({ date: '', name: '' });
      setResult(res.recomputed?.updated ? { msg: `คำนวณรายการเดิมใหม่ ${res.recomputed.updated} รายการ` } : null);
      load();
    } catch (err) { setError(err.message); }
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

      <div className="row" style={{ marginBottom: 14 }}>
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
      </div>

      <form className="row" onSubmit={add} style={{ marginBottom: 16 }}>
        <div className="field" style={{ maxWidth: 170 }}>
          <label>วันที่</label>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </div>
        <div className="field">
          <label>ชื่อวันหยุด</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <button className="btn">เพิ่ม</button>
      </form>

      {rows.length === 0 ? <Empty>ยังไม่มีวันหยุดในปีนี้</Empty> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>วันที่</th><th>วัน</th><th>ชื่อวันหยุด</th><th>ที่มา</th><th /></tr></thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h._id}>
                  <td>{thaiDate(h.date)}</td>
                  <td>วัน{dayName(h.date)}</td>
                  <td>{h.name}</td>
                  <td>{h.source === 'import' ? 'นำเข้า' : 'เพิ่มเอง'}</td>
                  <td><button className="btn ghost sm" onClick={() => remove(h._id)}>ลบ</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── policy: the twelve [OPEN] answers ───────────────────────────────────────

const POLICY_FIELDS = [
  {
    key: 'breakMode', open: 1, label: 'การหักเวลาพัก',
    options: [
      ['lunchWindow', 'หักเฉพาะช่วงที่คาบเกี่ยว 12:00–13:00 (ค่าเริ่มต้น)'],
      ['threshold', 'หัก 1 ชม. เมื่อทำงานเกินเกณฑ์'],
      ['always', 'หัก 1 ชม. ทุกครั้ง'],
      ['none', 'ไม่หักเลย'],
    ],
  },
  {
    key: 'breakPerCalendarDay', open: 2, label: 'ทำงานข้ามคืน หักพักกี่ครั้ง', bool: true,
    options: [[true, 'หักตามจำนวนวันที่คาบเกี่ยว'], [false, 'หักครั้งเดียวเสมอ']],
  },
  {
    key: 'roundingMode', open: 3, label: 'การปัดเศษ 30 นาที',
    options: [['floor', 'ปัดลง'], ['ceil', 'ปัดขึ้น'], ['nearest', 'ปัดใกล้ที่สุด']],
  },
  {
    key: 'belowMinimum', open: 4, label: 'ต่ำกว่าขั้นต่ำ 1 ชม.',
    options: [
      ['accept', 'รับตามชั่วโมงจริง (ติดธงให้ HR)'],
      ['raise', 'ปัดขึ้นเป็น 1 ชม.'],
      ['reject', 'ไม่รับรายการ'],
    ],
  },
  {
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
    key: 'birthdayLeapFallback', label: 'วันเกิด 29 ก.พ. ในปีที่ไม่ใช่อธิกสุรทิน',
    options: [
      ['feb28', '28 ก.พ. (ค่าเริ่มต้น)'],
      ['mar01', '1 มี.ค.'],
      ['none', 'ไม่มีวันหยุดวันเกิดในปีนั้น'],
    ],
  },
  {
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
    key: 'hrMayReject', open: 7, label: 'HR ปฏิเสธรายการที่หัวหน้าอนุมัติแล้วได้หรือไม่', bool: true,
    options: [[true, 'ได้'], [false, 'ไม่ได้']],
  },
  {
    key: 'hrRejectReturnsTo', open: 7, label: 'เมื่อ HR ปฏิเสธ ส่งกลับไปที่',
    options: [['employee', 'พนักงาน (แก้ไขและส่งใหม่)'], ['manager', 'หัวหน้างาน']],
  },
  {
    key: 'capBehaviour', open: 8, label: 'เมื่อเกินเพดานแผนก',
    options: [['warn', 'เตือนแต่ให้ส่งได้ ให้ HR ตัดสิน'], ['block', 'ไม่ให้ส่ง']],
  },
  {
    key: 'capBasis', open: 9, label: 'เพดานนับชั่วโมงแบบใด',
    options: [['clock', 'ชั่วโมงที่ทำจริง (ตัวอย่าง D = 14)'], ['weighted', 'ชั่วโมงคูณอัตรา (ตัวอย่าง D = 31.5)']],
    hint: 'ใช้กับทั้งเพดานรายเดือนและรายสัปดาห์ — ทั้งสองนับด้วยเกณฑ์เดียวกันเสมอ',
  },
  {
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
    key: 'hrSummaryBasis', open: 12, label: 'ช่อง OT ×1.5 / ×3 ในใบฟอร์ม',
    options: [['raw', 'ชั่วโมงดิบ ยังไม่คูณ'], ['multiplied', 'คูณอัตราแล้ว']],
  },
];

/**
 * The dropdown's string, back to the type the policy stores.
 *
 * `bool` and `num` are declared on the field rather than sniffed from the
 * current value, because a value can be legitimately absent — a policy key the
 * database has no override for yet reads as undefined, and guessing its type
 * from that would send a string on the one save that introduces it.
 */
function coerce(field, raw) {
  if (field.bool) return raw === 'true';
  if (field.num) return Number(raw);
  return raw;
}

/**
 * The badge, and the one button that removes it.
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
      <span
        style={{
          display: 'inline-block',
          fontSize: 11,
          fontWeight: 700,
          padding: '1px 7px',
          borderRadius: 999,
          background: 'var(--amber-bg, #fdf0d5)',
          color: 'var(--amber-dark, #8a5a00)',
          border: '1px solid var(--amber, #d99b1c)',
        }}
      >
        รอ HR ยืนยัน
      </span>
      <div className="hint" style={{ marginTop: 4 }}>
        ค่าที่ใช้อยู่: <strong>{item.reading}</strong> · ตั้งตามพฤติกรรมเดิม ณ {item.since} ยังไม่มีใครใน HR ตอบข้อนี้
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
      HR ยืนยันแล้ว{byName ? ` โดย ${byName}` : ''}
      {at ? ` · ${thaiDate(String(at).slice(0, 10))}` : ''}
    </div>
  );
}

function Policy({ user }) {
  const [policy, setPolicy] = useState(null);
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

  async function load() {
    try {
      const [res, history] = await Promise.all([
        api.get('/settings'),
        api.get('/settings/policy-versions'),
      ]);
      setPolicy(res.policy);
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
    try {
      const res = await api.patch('/settings/policy', { policy: { [key]: value }, note });
      setPolicy(res.policy);

      // Named rather than counted. "5 รายการ" says work happened; the version
      // is what a reader can go and look at afterwards, and what the rows those
      // 5 entries now carry will say.
      const stamped = res.versionCreated && res.policyVersion
        ? ` · บันทึกเป็นเวอร์ชัน ${res.policyVersion.seq}`
        : '';
      setMsg(res.recomputed?.updated
        ? `บันทึกแล้ว${stamped} · คำนวณรายการที่ยังไม่อนุมัติใหม่ ${res.recomputed.updated} รายการ`
        : `บันทึกแล้ว${stamped}`);
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

      {/* Typed before the dropdown is touched, because changing a dropdown IS
          the save — there is no button to attach a reason to afterwards. */}
      {canEdit && (
        <div className="field" style={{ maxWidth: 520 }}>
          <label>เหตุผลของการเปลี่ยนแปลง (ไม่บังคับ แต่จะถูกบันทึกไว้กับเวอร์ชัน)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น ฝ่ายบุคคลตอบ OPEN 3 ในที่ประชุม 5 ส.ค."
            disabled={busy}
          />
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th style={{ width: 80 }}>ข้อ</th><th>คำถาม</th><th>คำตอบปัจจุบัน</th></tr></thead>
          <tbody>
            {POLICY_FIELDS.map((f) => (
              <tr key={f.key}>
                <td>
                  {/* Rules that arrived after the twelve [OPEN] items have no
                      number to carry, and printing "OPEN undefined" beside one
                      would make it look like an item somebody forgot. */}
                  {f.open ? `OPEN ${f.open}` : '—'}
                  {overrides.includes(f.key) && (
                    <div style={{ fontSize: 11.5, color: 'var(--green-dark)' }}>HR ตอบแล้ว</div>
                  )}
                </td>
                <td>
                  {f.label}
                  {f.hint && (
                    <div className="hint" style={{ marginTop: 4 }}>{f.hint}</div>
                  )}
                  {/* One question can cover more than one flag, so a row can
                      wear more than one badge. */}
                  {unconfirmed.filter((u) => u.keys.includes(f.key)).map((u) => (
                    <React.Fragment key={u.id}>
                      <Unconfirmed item={u} canEdit={canEdit} busy={busy} onConfirm={confirm} />
                      <ConfirmedBy item={u} />
                    </React.Fragment>
                  ))}
                </td>
                <td>
                  <select
                    disabled={!canEdit || busy}
                    value={f.bool || f.num ? String(policy[f.key]) : policy[f.key]}
                    /* A <select> hands back a string whatever the option held.
                       Coerced on the way out or the policy would store "1"
                       where it stores 1 — `canonicalPolicy` compares values,
                       so a saved string reads as a changed answer and mints a
                       version on every save that changed nothing. */
                    onChange={(e) => save(f.key, coerce(f, e.target.value))}
                    style={{ minWidth: 280 }}
                  >
                    {f.options.map(([v, l]) => (
                      <option key={String(v)} value={String(v)}>{l}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}

            {/* A question about a rule the engine has but the policy has no
                flag for. It gets a row of its own rather than being left off
                the page: the badge is a record of what has not been agreed,
                and an item with no dropdown is if anything the one most worth
                showing — nobody can find it by reading the settings. The
                คำตอบปัจจุบัน cell states what the code does today, in words,
                because there is no control whose value could state it. */}
            {unconfirmed.filter((u) => u.keys.length === 0).map((u) => (
              <tr key={u.id}>
                <td>—</td>
                <td>
                  {u.label}
                  <Unconfirmed item={u} canEdit={canEdit} busy={busy} onConfirm={confirm} />
                  <ConfirmedBy item={u} />
                </td>
                <td>
                  {u.reading}
                  <div className="hint" style={{ marginTop: 4 }}>
                    ไม่มีค่าตั้งให้เลือก — เปลี่ยนคำตอบข้อนี้ต้องแก้ตัวคำนวณ
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="hint" style={{ marginTop: 14 }}>
        OPEN 6 (กะงานต่างกันรายแผนก) ไม่ได้อยู่ในหน้านี้ — ถ้าคำตอบคือ “มี” จะต้องแก้โครงสร้างข้อมูล
        ไม่ใช่แค่ปรับค่า · OPEN 10 และ 11 รองรับทั้งไฟล์และการกรอกเองอยู่แล้ว
      </div>

      <PolicyHistory versions={versions} unversioned={unversioned} live={live} />
    </div>
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
          <table>
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
                  <td><strong>{v.seq}</strong></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {v.createdAt ? new Date(v.createdAt).toLocaleString('th-TH') : '—'}
                  </td>
                  <td>
                    {v.createdByName || <span style={{ color: 'var(--muted)' }}>ระบบ</span>}
                    {v.note && (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{v.note}</div>
                    )}
                  </td>
                  <td className="num">{v.entryCount}</td>
                  <td><PolicyChanges changes={v.changes} seq={v.seq} /></td>
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
