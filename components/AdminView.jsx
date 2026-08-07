'use client';

import React, { useEffect, useRef, useState } from 'react';
import { api, thaiDate, dayName, COMPANIES } from '@/lib/api.js';
import { Alert, Empty } from './common.jsx';

const SECTIONS = [
  { key: 'departments', label: 'แผนกและเพดาน' },
  { key: 'employees', label: 'พนักงาน' },
  { key: 'holidays', label: 'วันหยุดบริษัท' },
  { key: 'policy', label: 'นโยบายการคำนวณ' },
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
      {section === 'employees' && <Employees />}
      {section === 'holidays' && <Holidays />}
      {section === 'policy' && <Policy user={user} />}
    </>
  );
}

// ── departments ─────────────────────────────────────────────────────────────

function Departments() {
  const [rows, setRows] = useState([]);
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState({ code: '', name: '', nameTh: '', monthlyCapHours: '' });
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
      setForm({ code: '', name: '', nameTh: '', monthlyCapHours: '' });
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
        <button className="btn">เพิ่มแผนก</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>รหัส</th><th>ชื่อแผนก</th><th>หัวหน้างาน</th>
              <th className="num">จำนวนคน</th><th>เพดาน ชม./เดือน</th><th>สถานะ</th>
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
                <td>
                  <input
                    type="number" min="0" step="0.5" placeholder="ไม่กำหนด"
                    defaultValue={d.monthlyCapHours ?? ''}
                    style={{ width: 110 }}
                    onBlur={(e) => update(d._id, { monthlyCapHours: e.target.value })}
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

function Employees() {
  const [rows, setRows] = useState([]);
  const [depts, setDepts] = useState([]);
  const [form, setForm] = useState({
    code: '', name: '', position: '', birthDate: '', department: '', role: 'employee',
    company: '', password: '',
  });
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

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
    try {
      await api.post('/employees', form);
      setForm({
        code: '', name: '', position: '', birthDate: '', department: '', role: 'employee',
        company: '', password: '',
      });
      load();
    } catch (err) { setError(err.message); }
  }

  async function update(id, patch) {
    try {
      await api.patch(`/employees/${id}`, patch);
      load();
    } catch (err) { setError(err.message); }
  }

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setResult(await api.upload('/employees/import', file));
      load();
    } catch (err) { setError(err.message); } finally { if (fileRef.current) fileRef.current.value = ''; }
  }

  return (
    <div className="card">
      <h2>พนักงาน</h2>
      <div className="hint">
        เพิ่มทีละคน หรือนำเข้าเป็นไฟล์ CSV — รองรับทั้งสองแบบ จึงไม่ต้องรอคำตอบว่า HR จะส่งรายชื่อมาแบบไหน
        · ช่อง “บริษัท” ระบุว่าพนักงานคนนี้อยู่ในบัญชีเงินเดือนของบริษัทใด
        เว้นว่างได้ ระบบจะเดาจากรหัส (PM… = ไพรมัส, THT… = เดมเทค)
        · “วันเกิด” ไม่บังคับ และแก้ไขได้จากหน้านี้เท่านั้น —
        พนักงานเห็นได้ในหน้าข้อมูลส่วนตัวแต่แก้เองไม่ได้ (ในไฟล์ CSV ใช้รูปแบบ YYYY-MM-DD เป็น ค.ศ.)
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      <div className="row" style={{ marginBottom: 14 }}>
        <button
          className="btn ghost"
          onClick={() => api.download('/employees/import/template', 'employee-import-template.csv')}
        >
          ดาวน์โหลดแม่แบบ CSV
        </button>
        <label className="btn ghost" style={{ cursor: 'pointer' }}>
          นำเข้ารายชื่อจาก CSV
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={upload} style={{ display: 'none' }} />
        </label>
      </div>

      {result && (
        <Alert kind={result.errors?.length || result.warnings?.length ? 'warn' : 'ok'}>
          นำเข้าใหม่ {result.created} คน · ปรับปรุง {result.updated} คน
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
            <option value="employee">พนักงาน</option>
            <option value="manager">หัวหน้างาน</option>
            <option value="hr">ฝ่ายบุคคล</option>
            <option value="admin">ผู้ดูแลระบบ</option>
          </select>
        </div>
        <div className="field" style={{ maxWidth: 170 }}>
          <label>บริษัท</label>
          <select value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })}>
            <option value="">— เดาจากรหัส —</option>
            {COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </div>
        <button className="btn">เพิ่ม</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>รหัส</th><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>วันเกิด</th><th>แผนก</th>
              <th>บทบาท</th><th>บริษัท</th><th>สถานะ</th>
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
                  />
                </td>
                <td>{p.department?.nameTh || p.department?.name}</td>
                <td>{p.role}</td>
                <td>
                  <select
                    value={p.company || ''}
                    onChange={(e) => update(p._id, { company: e.target.value })}
                  >
                    {COMPANIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </td>
                <td>{p.active ? 'ใช้งาน' : 'ปิด'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
  },
  {
    key: 'hrSummaryBasis', open: 12, label: 'ช่อง OT ×1.5 / ×3 ในใบฟอร์ม',
    options: [['raw', 'ชั่วโมงดิบ ยังไม่คูณ'], ['multiplied', 'คูณอัตราแล้ว']],
  },
];

function Policy({ user }) {
  const [policy, setPolicy] = useState(null);
  const [overrides, setOverrides] = useState([]);
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
                  OPEN {f.open}
                  {overrides.includes(f.key) && (
                    <div style={{ fontSize: 11.5, color: 'var(--green-dark)' }}>HR ตอบแล้ว</div>
                  )}
                </td>
                <td>{f.label}</td>
                <td>
                  <select
                    disabled={!canEdit || busy}
                    value={f.bool ? String(policy[f.key]) : policy[f.key]}
                    onChange={(e) => save(f.key, f.bool ? e.target.value === 'true' : e.target.value)}
                    style={{ minWidth: 280 }}
                  >
                    {f.options.map(([v, l]) => (
                      <option key={String(v)} value={String(v)}>{l}</option>
                    ))}
                  </select>
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
