'use client';

import React, { useEffect, useRef, useState } from 'react';
import { api, thaiDate, dayName, COMPANIES } from '@/lib/api.js';
import { HR_ASSIGNABLE_ROLES, PASSWORD_MIN_LENGTH, defaultPassword } from '@/lib/employees.js';
import { parseCsv } from '@/src/lib/csv.js';
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
  code: '', name: '', position: '', birthDate: '', department: '', role: 'employee',
  company: '', password: '',
};

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
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  /** The password just issued, and who for — the one moment it is readable. */
  const [issued, setIssued] = useState(null);
  /** The row whose password is being reset, if any. */
  const [resetting, setResetting] = useState(null);
  /** A chosen file, read but not yet sent — see `choose` below. */
  const [pending, setPending] = useState(null);
  const [sending, setSending] = useState(false);
  const fileRef = useRef(null);

  // Mirrors rosterPermission() on the server. Not a substitute for it — the
  // server is what enforces this — but an option nobody may pick is better not
  // offered, and a disabled button explains itself where a 403 does not.
  const isAdmin = user?.role === 'admin';
  const roleOptions = isAdmin
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((o) => HR_ASSIGNABLE_ROLES.includes(o.value));
  const mayEdit = (row) => isAdmin || row.role !== 'admin';

  async function load() {
    try {
      const [e, d] = await Promise.all([api.get('/employees?all=1'), api.get('/departments?all=1')]);
      setRows(e.employees);
      setDepts(d.departments);
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await api.post('/employees', form);
      // Shown once, from the response — the server stores only the hash, so
      // this is the last time anyone can read it off a screen. HR reads it to
      // the new employee, who is made to replace it at first login.
      setIssued({ code: form.code, name: form.name, password: res.password });
      setForm(BLANK);
      load();
    } catch (err) { setError(err.message); }
  }

  async function update(id, patch) {
    try {
      await api.patch(`/employees/${id}`, patch);
      load();
    } catch (err) { setError(err.message); }
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
        · ทุกบัญชีที่สร้างจากหน้านี้จะถูกบังคับให้ตั้งรหัสผ่านใหม่เมื่อเข้าระบบครั้งแรก
        {!isAdmin && ' · บทบาท “ผู้ดูแลระบบ” ตั้งได้โดยผู้ดูแลระบบเท่านั้น'}
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      {/* The password, once. Dismissed by hand rather than by the next action:
          it is the thing HR has to write down or read out, and a notice that
          clears itself while somebody is reaching for a pen is a password
          nobody can recover — only reset. */}
      {issued && (
        <Alert kind="ok">
          สร้างบัญชี {issued.code} · {issued.name} แล้ว
          {' '}— รหัสผ่านเริ่มต้นคือ <strong style={{ fontFamily: 'var(--mono, monospace)' }}>{issued.password}</strong>
          <div style={{ marginTop: 4, fontSize: 12.5 }}>
            แจ้งรหัสนี้ให้พนักงาน · ระบบจะบังคับให้ตั้งรหัสผ่านใหม่เมื่อเข้าระบบครั้งแรก
            {' '}· รหัสนี้แสดงเพียงครั้งเดียว หากลืมให้ใช้ปุ่ม “ตั้งรหัสใหม่” ในตารางด้านล่าง
          </div>
          <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => setIssued(null)}>รับทราบ</button>
        </Alert>
      )}

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
        <Alert kind={result.errors?.length || result.warnings?.length ? 'warn' : 'ok'}>
          นำเข้าใหม่ {result.created} คน · ปรับปรุง {result.updated} คน
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

      <form className="row" onSubmit={create} style={{ marginBottom: 16 }}>
        <div className="field" style={{ maxWidth: 120 }}>
          <label>รหัสพนักงาน</label>
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
        </div>
        <div className="field">
          <label>ชื่อ-สกุล</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div className="field">
          <label>ตำแหน่ง</label>
          <input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
        </div>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>วันเกิด</label>
          <input
            type="date"
            value={form.birthDate}
            onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
          />
        </div>
        <div className="field" style={{ maxWidth: 160 }}>
          <label>แผนก</label>
          <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} required>
            <option value="">— เลือก —</option>
            {depts.map((d) => <option key={d._id} value={d._id}>{d.nameTh || d.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 130 }}>
          <label>บทบาท</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field" style={{ maxWidth: 170 }}>
          <label>บริษัท</label>
          <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
            <option value="">— เดาจากรหัส —</option>
            {COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        {/* Left blank this is defaultPassword(code) — shown as the placeholder
            so HR can see what they will be reading out before they decide
            whether to type something else. */}
        <div className="field" style={{ maxWidth: 200 }}>
          <label>รหัสผ่านเริ่มต้น</label>
          <input
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={form.code ? defaultPassword(form.code) : 'เว้นว่าง = ตั้งจากรหัสพนักงาน'}
            minLength={PASSWORD_MIN_LENGTH}
          />
        </div>
        <button className="btn">เพิ่ม</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>รหัส</th><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>วันเกิด</th><th>แผนก</th>
              <th>บทบาท</th><th>บริษัท</th><th>สถานะ</th><th>รหัสผ่าน</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p._id}>
                <td>{p.code}</td>
                <td>{p.name}</td>
                <td>{p.position}</td>
                {/* Editable here and nowhere else — the employee sees it on
                    ข้อมูลส่วนตัว but cannot change it. */}
                <td>
                  <input
                    type="date"
                    value={p.birthDate || ''}
                    onChange={(e) => update(p._id, { birthDate: e.target.value })}
                    disabled={!mayEdit(p)}
                  />
                </td>
                <td>{p.department?.nameTh || p.department?.name}</td>
                <td>{ROLE_OPTIONS.find((o) => o.value === p.role)?.label || p.role}</td>
                <td>
                  <select
                    value={p.company || ''}
                    onChange={(e) => update(p._id, { company: e.target.value })}
                    disabled={!mayEdit(p)}
                  >
                    {COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </td>
                <td>{p.active ? 'ใช้งาน' : 'ปิด'}</td>
                <td>
                  {/* ลืมรหัสผ่าน has no self-service path — no email is on file
                      for most of the roster — so this is the whole of the
                      recovery story, and it belongs on the row rather than
                      behind an edit screen nobody opens for one field. */}
                  <button
                    className="btn ghost"
                    onClick={() => setResetting(p)}
                    disabled={!mayEdit(p)}
                    title={mayEdit(p) ? 'ตั้งรหัสผ่านใหม่ให้พนักงานคนนี้' : 'บัญชีผู้ดูแลระบบตั้งรหัสใหม่ได้โดยผู้ดูแลระบบเท่านั้น'}
                  >
                    ตั้งรหัสใหม่
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {resetting && (
        <ResetPassword
          employee={resetting}
          onClose={() => setResetting(null)}
          onDone={(password) => {
            setResetting(null);
            setIssued({ code: resetting.code, name: resetting.name, password });
          }}
        />
      )}
    </div>
  );
}

/**
 * ตั้งรหัสผ่านใหม่ให้พนักงาน — the counterpart to creating the account, for the
 * day somebody forgets.
 *
 * The suggested value is the same one a new account gets, because the shape HR
 * has to read down the phone should not depend on whether this is the first
 * time or the third. Whatever is set here comes back with the same obligation:
 * the employee cannot reach any other screen until they have replaced it.
 */
function ResetPassword({ employee, onClose, onDone }) {
  const suggestion = defaultPassword(employee.code);
  const [password, setPassword] = useState(suggestion);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = password.length >= PASSWORD_MIN_LENGTH;

  async function submit() {
    setError('');
    setBusy(true);
    try {
      await api.patch(`/employees/${employee._id}`, { password });
      onDone(password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="ตั้งรหัสผ่านใหม่"
      subtitle={`${employee.code} · ${employee.name}`}
      onClose={onClose}
      dirty={password !== suggestion && !busy}
      footer={<>
        <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
        <button className="btn" onClick={submit} disabled={busy || !ready}>
          {busy ? 'กำลังบันทึก…' : 'ตั้งรหัสผ่านใหม่'}
        </button>
      </>}
    >
      <div className="hint">
        รหัสผ่านเดิมของพนักงานคนนี้จะใช้ไม่ได้ทันที
        {' '}· เมื่อเข้าระบบด้วยรหัสใหม่ ระบบจะบังคับให้ตั้งรหัสผ่านของตัวเองก่อนใช้งาน
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="field">
        <label>รหัสผ่านใหม่</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={PASSWORD_MIN_LENGTH}
          autoComplete="off"
        />
        {!ready && (
          <div className="field-note error">ต้องยาวอย่างน้อย {PASSWORD_MIN_LENGTH} ตัวอักษร</div>
        )}
      </div>
      {password !== suggestion && (
        <button className="btn ghost" onClick={() => setPassword(suggestion)}>
          ใช้รหัสเริ่มต้น ({suggestion})
        </button>
      )}
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
    options: [['raise', 'ปัดขึ้นเป็น 1 ชม.'], ['reject', 'ไม่รับรายการ']],
  },
  {
    key: 'otStartsAtCoreEnd', open: 5, label: 'OT เริ่มนับที่', bool: true,
    options: [[true, '17:00 (นับเต็ม 3 ชม. สำหรับ 17:00–20:00)'], [false, '17:01']],
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
