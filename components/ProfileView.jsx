'use client';

import React, { useEffect, useState } from 'react';
import { api, thaiDate, COMPANIES } from '@/lib/api.js';
import { PASSWORD_MIN_LENGTH } from '@/lib/employees.js';
import { Alert } from './common.jsx';
import Delegation from './Delegation.jsx';

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
      {/* Where a หัวหน้า arranges their own cover — on the page they are
          already on when they know they will be away. ฝ่ายบุคคล have the same
          screen under ตั้งค่าระบบ for the หัวหน้า who is already gone. */}
      {user.role === 'manager' && <Delegation user={user} scope="mine" />}
      <ThemeChoice />
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

// ── ธีมสีของหน้าจอ ──────────────────────────────────────────────────────────

const THEME_KEY = 'ot-theme';

/**
 * สว่าง / มืด / ตามเครื่อง — the one setting on this page that is not about
 * the person at all.
 *
 * IT IS STORED IN THE BROWSER, NOT ON THE ACCOUNT, and that is the decision
 * worth writing down. A theme belongs to the screen somebody is looking at: the
 * same person on the office desktop under fluorescent light and on a phone at
 * 21:00 wants different answers, and a setting saved to the account would give
 * them one. It also means the shared ฝ่ายบุคคล login does not force one
 * person's choice onto everybody else who uses it.
 *
 * The cost is honest: it does not follow anybody to a new machine, and clearing
 * the browser's data clears it. Both are the right trade for a preference that
 * changes nothing about the data and everything about one screen.
 *
 * "ตามเครื่อง" is the absence of the key rather than a third stored value, so
 * somebody who has never touched this gets exactly what they got before the
 * setting existed — and following the machine keeps following it afterwards,
 * including when the machine changes its own mind at sunset.
 */
const THEMES = [
  { key: 'system', label: 'ตามเครื่อง', hint: 'เปลี่ยนตามที่ตั้งไว้ในเครื่องหรือระบบปฏิบัติการ' },
  { key: 'light', label: 'สว่าง', hint: 'พื้นขาว แบบเดิมของระบบ' },
  { key: 'dark', label: 'มืด', hint: 'พื้นเข้ม สำหรับที่แสงน้อย' },
];

function ThemeChoice() {
  /**
   * Read on mount, never during render.
   *
   * The server renders this component too, and there is no localStorage there —
   * a first render that read it would either throw or disagree with what the
   * boot script in app/layout.js has already applied to <html>, and React would
   * hydrate the mismatch. Starting from the DOM's own attribute is the one
   * source that is right in both places.
   */
  const [choice, setChoice] = useState('system');
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      setChoice(stored === 'dark' || stored === 'light' ? stored : 'system');
    } catch { /* a browser with storage blocked: the default stands */ }
  }, []);

  function pick(key) {
    setChoice(key);
    // The attribute the CSS reads, and the key the boot script reads next time.
    // Both, in that order: the screen changes before the write can fail.
    if (key === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = key;
    try {
      if (key === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, key);
    } catch { /* the choice still applies to this tab */ }
  }

  return (
    <div className="card">
      <h2>ธีมสีหน้าจอ</h2>
      <div className="hint">
        จำไว้เฉพาะในเบราว์เซอร์นี้ · เครื่องอื่นหรือโทรศัพท์ตั้งแยกกันได้
        {' '}· ใบที่พิมพ์ออกกระดาษเป็นพื้นขาวเสมอไม่ว่าตั้งไว้แบบไหน
      </div>
      <div className="seg" style={{ marginTop: 12 }} role="group" aria-label="ธีมสีหน้าจอ">
        {THEMES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={choice === t.key ? 'active' : ''}
            aria-pressed={choice === t.key}
            onClick={() => pick(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>
        {THEMES.find((t) => t.key === choice)?.hint}
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

const MIN_LENGTH = PASSWORD_MIN_LENGTH; // one number, shared with the server

/**
 * เปลี่ยนรหัสผ่าน — the same form on ข้อมูลส่วนตัว and on the first-login gate.
 *
 * `onDone` is how the gate finds out it can let go: it re-reads /auth/me, sees
 * mustChangePassword cleared, and the shell appears. On the profile page nobody
 * passes it and the form simply says it worked.
 */
export function ChangePassword({ onDone, hint }) {
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
  // Re-typing the issued password would clear mustChangePassword without
  // changing anything, so the server refuses it — said here too, before the
  // round trip, where the typing is still on screen.
  const unchanged = next.length > 0 && next === current;
  const ready = current && next.length >= MIN_LENGTH && next === confirm && !unchanged;

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
      await onDone?.();
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
        {hint || <>
          รหัสผ่านใหม่ต้องยาวอย่างน้อย {MIN_LENGTH} ตัวอักษร
          · เซสชันที่เปิดค้างอยู่บนเครื่องอื่นจะยังใช้ได้จนหมดอายุ
        </>}
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
          {unchanged && <div className="field-note error">รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม</div>}
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
