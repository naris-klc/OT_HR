'use client';

import React, { useState } from 'react';
import { api, thaiDate, COMPANIES } from '@/lib/api.js';
import { Alert } from './common.jsx';

const ROLE_LABEL = {
  employee: 'พนักงาน', manager: 'หัวหน้างาน', hr: 'ฝ่ายบุคคล', admin: 'ผู้ดูแลระบบ',
};

/**
 * ข้อมูลส่วนตัว — what the signed-in person may see and change about
 * themselves.
 *
 * The only editable thing is the password. Name, วันเกิด, แผนก and บทบาท are
 * HR master data: ชื่อ-สกุล is what prints on F-HR-027 and what payroll
 * matches against, so a self-service edit would silently restate submitted
 * forms. They are shown read-only, with a line saying who to ask.
 */
export default function ProfileView({ user, onLogout }) {
  return (
    <div className="stack">
      <Details user={user} />
      <ChangePassword />
      {/* On mobile the sidebar — and with it the ออกจากระบบ button — is not on
          screen, and the appbar avatar now opens this page instead of signing
          out. This is the only sign-out there, so it is not hidden on desktop
          either: two of them is better than a phone with none. */}
      <div className="card">
        <button className="btn ghost" onClick={onLogout}>ออกจากระบบ</button>
      </div>
    </div>
  );
}

// ── read-only details ───────────────────────────────────────────────────────

function Details({ user }) {
  const company = COMPANIES.find((c) => c.key === user.company);

  const fields = [
    ['รหัสพนักงาน', user.code],
    ['ชื่อ-สกุล', user.name],
    ['ตำแหน่ง', user.position],
    ['วันเกิด', user.birthDate ? thaiDate(user.birthDate) : null],
    ['แผนก', user.department?.name],
    ['บทบาท', ROLE_LABEL[user.role]],
    ['บริษัท', company?.label],
  ];

  return (
    <div className="card">
      <h2>ข้อมูลส่วนตัว</h2>
      <div className="hint">
        ข้อมูลด้านล่างมาจากทะเบียนพนักงานของฝ่ายบุคคล
        · ชื่อ-สกุลเป็นชื่อที่พิมพ์ลงใบ F-HR-027 จึงแก้ไขเองไม่ได้
        หากมีข้อมูลใดไม่ถูกต้อง กรุณาแจ้งฝ่ายบุคคลเพื่อแก้ไข
      </div>

      <dl className="profile-facts">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ── password ────────────────────────────────────────────────────────────────

const MIN_LENGTH = 6; // matches POST /api/employees/me/password

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  // Checked here as well as on the server: the server never sees `confirm`,
  // so a typo in it is only catchable on this side.
  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const ready = current && next.length >= MIN_LENGTH && next === confirm;

  async function submit(e) {
    e.preventDefault();
    setError('');
    setOk('');
    setBusy(true);
    try {
      await api.post('/employees/me/password', { current, next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setOk('เปลี่ยนรหัสผ่านแล้ว · ครั้งต่อไปให้เข้าสู่ระบบด้วยรหัสผ่านใหม่');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>เปลี่ยนรหัสผ่าน</h2>
      <div className="hint">
        รหัสผ่านใหม่ต้องยาวอย่างน้อย {MIN_LENGTH} ตัวอักษร
        · เซสชันที่เปิดค้างอยู่บนเครื่องอื่นจะยังใช้ได้จนหมดอายุ
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      <form onSubmit={submit} className="profile-form">
        <div className="field">
          <label>รหัสผ่านเดิม · CURRENT PASSWORD</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        <div className="field">
          <label>รหัสผ่านใหม่ · NEW PASSWORD</label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_LENGTH}
            required
          />
          {tooShort && <div className="field-note error">สั้นเกินไป — ต้องยาวอย่างน้อย {MIN_LENGTH} ตัวอักษร</div>}
        </div>

        <div className="field">
          <label>ยืนยันรหัสผ่านใหม่ · CONFIRM</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
          />
          {mismatch && <div className="field-note error">รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน</div>}
        </div>

        <button className="btn" disabled={busy || !ready}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}
        </button>
      </form>
    </div>
  );
}
