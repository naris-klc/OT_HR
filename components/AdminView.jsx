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

export default function AdminView({ user }) {
  const [section, setSection] = useState('departments');
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
    code: '', name: '', position: '', department: '', role: 'employee', company: '', password: '',
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
        code: '', name: '', position: '', department: '', role: 'employee', company: '', password: '',
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
        เว้นว่างได้ ระบบจะเดาจากรหัส (PM… = ไพรมัส, THT… = เดอะเอ็มเทค)
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
              <th>รหัส</th><th>ชื่อ-สกุล</th><th>ตำแหน่ง</th><th>แผนก</th>
              <th>บทบาท</th><th>บริษัท</th><th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p._id}>
                <td>{p.code}</td>
                <td>{p.name}</td>
                <td>{p.position}</td>
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
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await api.get('/settings');
      setPolicy(res.policy);
      setOverrides(res.overrides);
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, []);

  async function save(key, value) {
    setBusy(true);
    setError('');
    try {
      const res = await api.patch('/settings/policy', { policy: { [key]: value } });
      setPolicy(res.policy);
      setMsg(res.recomputed?.updated
        ? `บันทึกแล้ว · คำนวณรายการที่ยังไม่อนุมัติใหม่ ${res.recomputed.updated} รายการ`
        : 'บันทึกแล้ว');
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
    </div>
  );
}
