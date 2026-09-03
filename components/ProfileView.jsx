'use client';

import React, { useEffect, useState } from 'react';
import { isSigner } from '@/lib/roles.js';
import { api, thaiDate, COMPANIES } from '@/lib/api.js';
import { PASSWORD_MIN_LENGTH, passwordShapePermission } from '@/lib/employees.js';
import { Alert, PasswordInput } from './common.jsx';
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
    /* `profile-page` is not a layout — `.stack` is still doing that. It is the
       handle the stylesheet needs to give THESE cards 24px of padding without
       restating every queue, table and modal in the app. See the rule beside
       `.profile-form`. */
    <div className="stack profile-page">
      <Details user={user} />
      {/* Where a หัวหน้า arranges their own cover — on the page they are
          already on when they know they will be away. ฝ่ายบุคคล have the same
          screen under ตั้งค่าระบบ for the หัวหน้า who is already gone. */}
      {isSigner(user.role) && <Delegation user={user} scope="mine" />}
      <ThemeChoice />
      <ChangePassword />
      {/* On mobile the sidebar — and with it the ออกจากระบบ button — is not on
          screen, and the appbar avatar now opens this page instead of signing
          out. This is the only sign-out there, so it is not hidden on desktop
          either: two of them is better than a phone with none. */}
      <div className="card">
        {/* A RED OUTLINE, not the grey ghost it was. This is the only button on
            the page that takes something away: the session goes, and with it
            anything half-typed in another tab. Drawn as `.btn.ghost` it was the
            same object as ธีมสีหน้าจอ's three choices and บันทึกรหัสผ่านใหม่'s own
            disabled state — a grey box among grey boxes, sitting directly under
            a form somebody has just been tabbing through, on a phone.

            `.btn.ghost.danger` is the voice this app already uses for a button
            that refuses or undoes — ไม่อนุมัติ, ยกเลิกคำขอ, ปลดล็อกงวด — so it is
            recognised here rather than invented. Outlined and not filled: the
            filled red is reserved for what cannot be taken back, and signing
            out is undone by signing in. */}
        <button className="btn ghost danger" onClick={onLogout}>ออกจากระบบ</button>
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
 * The sentence under the box, and the whole of what somebody needs before
 * typing.
 *
 * It read "รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร" until 2026-09-02 and said
 * nothing about which characters were allowed — which was fine while the answer
 * was "any", and stopped being fine the moment the server grew a character set.
 * A rule the server enforces and the form does not mention is a rule somebody
 * meets as a refusal.
 *
 * Said in one line rather than as a list of classes: the point of the change is
 * that Thai works, so Thai is named first.
 */
const PASSWORD_HELP = `รหัสผ่านต้องมีความยาวอย่างน้อย ${MIN_LENGTH} ตัวอักษร `
  + '(สามารถใช้ตัวอักษรไทย ตัวอักษรอังกฤษ ตัวเลข หรืออักขระพิเศษได้)';

/**
 * WHAT THE BROWSER AND ITS EXTENSIONS MUST NOT DO TO THIS FORM.
 *
 * Three boxes in a row, two of them named "password", is the exact shape a
 * password manager is built to fill — and every one of them is wrong about this
 * form. Chrome offered the saved password into รหัสผ่านเดิม and then into
 * รหัสผ่านใหม่ as well, which submits current === next and gets the server's
 * "must not repeat" back; LastPass and 1Password draw their own icon over the
 * right-hand end of the box, on top of the reveal eye, so the one control that
 * checks what was typed is the one the overlay covers; and the manager's own
 * "save this password?" bubble lands over the ยืนยัน field mid-typing.
 *
 * `autocomplete="new-password"` ON ALL THREE, including รหัสผ่านเดิม, which is
 * the part worth being deliberate about. `current-password` is the correct
 * semantic there and it is exactly what invites the fill; this form asks
 * somebody to PROVE they know the old password before it will change it, and a
 * value the browser typed proves nothing about the person at the keyboard. The
 * cost is real and accepted: anybody who has never memorised their password has
 * to go and copy it out of the manager. On the first-login gate — where the
 * password being typed is the one HR read out over the phone an hour ago —
 * there was nothing saved to fill anyway.
 *
 * The two `data-` attributes are not standards. They are the opt-outs LastPass
 * and 1Password/Dashlane actually read, because `autocomplete` alone has never
 * been enough to stop an extension — every major manager treats it as a hint it
 * may overrule. React passes unknown `data-*` through to the DOM untouched,
 * which is the whole reason they can be written here as ordinary props.
 */
const NO_AUTOFILL = {
  autoComplete: 'new-password',
  'data-lpignore': 'true',
  'data-form-type': 'other',
};

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
  /**
   * THREE FLAGS, NOT ONE. Revealing รหัสผ่านใหม่ to check what was typed must
   * not also put the old password on screen — the two are different secrets and
   * only one of them is being chosen. It is also the pair the form asks somebody
   * to compare: showing รหัสผ่านใหม่ and ยืนยัน together is the whole reason to
   * reveal anything here, and a single flag would have made that impossible to
   * do without exposing the third box as well.
   *
   * All three start false on every mount — see `PasswordInput`. Nothing here
   * remembers a revealed box between visits.
   */
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Checked here as well as on the server: the server never sees `confirm`,
  // so a typo in it is only catchable on this side.
  const mismatch = confirm.length > 0 && next !== confirm;
  /**
   * The server's own rule, run on what is in the box — imported rather than
   * restated, for the reason AddEmployee imports it too: a length and a
   * character set written twice is a pair that agrees until one is edited.
   *
   * It replaced a bare `next.length < MIN_LENGTH` on 2026-09-02. The message
   * matters more than the check does: when a refusal is about a character
   * rather than a length, "สั้นเกินไป" sends somebody to add letters to a
   * password that will be refused again — the shared rule names the character
   * instead, including the ones that render as nothing.
   */
  const shape = next.length > 0 ? passwordShapePermission(next) : { ok: true };
  // Re-typing the issued password would clear mustChangePassword without
  // changing anything, so the server refuses it — said here too, before the
  // round trip, where the typing is still on screen.
  const unchanged = next.length > 0 && next === current;
  const ready = current && next.length > 0 && shape.ok && next === confirm && !unchanged;

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
          {PASSWORD_HELP}
          {' '}· เซสชันที่เปิดค้างอยู่บนเครื่องอื่นจะยังใช้ได้จนหมดอายุ
        </>}
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="ok">{ok}</Alert>}

      <form onSubmit={submit} className="profile-form">
        <div className="field">
          <label>รหัสผ่านเดิม</label>
          <PasswordInput
            placeholder="CURRENT PASSWORD"
            shown={showCurrent}
            onToggle={() => setShowCurrent((v) => !v)}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            {...NO_AUTOFILL}
            required
          />
        </div>

        <div className="field">
          <label>รหัสผ่านใหม่</label>
          <PasswordInput
            placeholder="NEW PASSWORD"
            shown={showNext}
            onToggle={() => setShowNext((v) => !v)}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            {...NO_AUTOFILL}
            minLength={MIN_LENGTH}
            required
          />
          {!shape.ok && <div className="field-note error">{shape.error}</div>}
          {unchanged && <div className="field-note error">รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม</div>}
        </div>

        <div className="field">
          <label>ยืนยันรหัสผ่านใหม่</label>
          <PasswordInput
            placeholder="CONFIRM"
            shown={showConfirm}
            onToggle={() => setShowConfirm((v) => !v)}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            {...NO_AUTOFILL}
            required
          />
          {mismatch && <div className="field-note error">รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน</div>}
        </div>

        {/* THE GREEN IS THE ANSWER TO "IS THIS READY?" — `.btn` fills green the
            moment `ready` turns true, and the app's disabled rule paints it
            grey with a border until then, which is what the screen shows for
            most of the time somebody is on it.

            What was missing is the sentence saying so. A grey box that never
            reacts reads as a broken button, not as a button waiting: the three
            per-field notes only appear once a rule is actually broken, so a
            form with รหัสผ่านเดิม still empty said nothing at all. This line
            names the condition and names the colour, so the change to green is
            read as the form agreeing rather than as a coincidence.

            It stands down as soon as a field has its own complaint — repeating
            "กรอกให้ครบ" under "ทั้งสองช่องไม่ตรงกัน" would be the screen talking
            over itself. */}
        <div className="profile-submit">
          <button className="btn" disabled={busy || !ready}>
            {busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}
          </button>
          {!ready && !busy && shape.ok && !unchanged && !mismatch && (
            <div className="field-note">กรอกให้ครบทั้งสามช่อง ปุ่มจึงจะเป็นสีเขียวและกดบันทึกได้</div>
          )}
        </div>
      </form>
    </div>
  );
}
