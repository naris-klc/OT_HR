'use client';

import React, { useEffect, useRef, useState } from 'react';
import { isSigner, roleLabel } from '@/lib/roles.js';
import { api, thaiDate, COMPANIES } from '@/lib/api.js';
import { PASSWORD_MIN_LENGTH, passwordShapePermission } from '@/lib/employees.js';
import { Alert, NoticeRow, NoticeStack, PasswordInput, TablePager, pageWindow } from './common.jsx';
import Icon from './icons.jsx';
import { useToast } from './Toast.jsx';
import Delegation from './Delegation.jsx';

/**
 * ข้อมูลส่วนตัว — what the signed-in person may see and change about
 * themselves.
 *
 * The only editable thing is the password. Name, วันเกิด, แผนก and บทบาท are
 * HR master data: ชื่อ-สกุล is what prints on F-HR-027 and what payroll
 * matches against, so a self-service edit would silently restate submitted
 * forms. They are shown read-only, with a line saying who to ask.
 */
export default function ProfileView({ user, jumpTo = null, onPasswordChanged, onLogout }) {
  return (
    /* `profile-page` is not a layout — `.stack` is still doing that. It is the
       handle the stylesheet needs to give THESE cards 24px of padding without
       restating every queue, table and modal in the app. See the rule beside
       `.profile-form`. */
    <div className="stack profile-page">
      {/* กล่องแจ้งเตือนของหน้า — ว่างเอง เปลี่ยนรหัสผ่าน ผู้รับช่วงอนุมัติ และ พนักงานที่คุณมีสิทธิ์อนุมัติ
          ส่งแถวมารวมที่นี่ผ่าน `NoticePage` (2026-10-10 · รายงาน UX ข.2) */}
      <NoticeStack id="profile" />
      {/* สองคอลัมน์ (แบบ A, เลือกไว้ 2026-10-08): ซ้ายคือข้อมูลกับธีม ขวาคือรหัสผ่านกับทางออก
          — ฟอร์มรหัสผ่านกว้างแค่ 380px ฝั่งขวาของการ์ดเดิมจึงว่างทั้งหน้า · ต่ำกว่า
          860px เรียงลงเป็นคอลัมน์เดียว */}
      <div className="profile-grid">
        <div className="profile-col">
          <Details user={user} />
          <ThemeChoice />
        </div>
        {/* `pending` is the flag itself: this is where the reminder strip on the
            landing tab sends somebody, and since the first-login screen was
            deleted it is the only screen that explains what their current
            password is. The form is the same one either way — the flag adds the
            two sentences that screen used to carry.

            `jump` is that same arrival seen from the other end: the strip names
            เปลี่ยนรหัสผ่าน and this card scrolls itself onto the screen rather
            than leaving somebody to find it. Nothing else on this page sets it. */}
        <ChangePassword
          pending={user.mustChangePassword}
          jump={jumpTo === 'password'}
          onDone={onPasswordChanged}
        >
          {/* On mobile the sidebar — and with it the ออกจากระบบ button — is not on
              screen, and the appbar avatar opens this page instead of signing
              out, so this is the only sign-out there; two on desktop is better
              than a phone with none.

              A RED OUTLINE (`.btn.ghost.danger`), the voice the app already uses
              for a button that refuses or undoes. Outlined and not filled: the
              filled red is reserved for what cannot be taken back, and signing
              out is undone by signing in. It sits in the password card's button
              row, away from the green save so the two are not mistaken. */}
          <button type="button" className="btn ghost danger" onClick={onLogout}><Icon name="logout" />ออกจากระบบ</button>
        </ChangePassword>
      </div>
      {/* Where a หัวหน้า arranges their own cover — on the page they are
          already on when they know they will be away. ฝ่ายบุคคล have the same
          screen under ตั้งค่าระบบ for the หัวหน้า who is already gone. */}
      {isSigner(user.role) && <Delegation user={user} scope="mine" />}
      {isSigner(user.role) && <MyTeam />}
    </div>
  );
}

// ── พนักงานที่คุณมีสิทธิ์อนุมัติ ────────────────────────────────────────────

/** 10 to a page, and a pager only past that — asked for in as many words. */
const TEAM_PAGE = 10;

/**
 * พนักงานที่คุณมีสิทธิ์อนุมัติ — the people whose first step this person signs,
 * at the foot of the page. แบบ C, chosen from three mockups on 2026-10-09:
 * grouped by แผนก with a count on each heading, no รายคน/ตามแผนก tag — the
 * reader asked WHO, and how HR wired each one is ทะเบียนพนักงาน's business.
 *
 * หัวการ์ดเคยเป็น "ผู้ใต้บังคับบัญชาที่อนุมัติ" จนถึง 2026-10-11 — อ่านได้ว่า
 * ลูกน้องเป็นคนอนุมัติ ทั้งที่หมายถึงคนที่ผู้อ่านอนุมัติให้ ชื่อใหม่ผู้ใช้เลือกเอง
 *
 * Groups are cut per page: a แผนก that runs across the page break shows its
 * heading again on the next page, counting the rows on THAT page, so no row
 * ever sits under a heading the reader cannot see.
 */
function MyTeam() {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(TEAM_PAGE);

  useEffect(() => {
    api.get('/employees/me/team')
      .then((r) => setPeople(r.people || []))
      .catch((e) => setError(e.message || 'โหลดรายชื่อไม่สำเร็จ'));
  }, []);

  const total = people?.length || 0;
  const paged = total > TEAM_PAGE;
  const win = pageWindow(page, pageSize, total, paged);
  const rows = (people || []).slice(win.from, win.to);
  const groups = [];
  for (const p of rows) {
    const last = groups[groups.length - 1];
    if (last && last.name === p.department) last.rows.push(p);
    else groups.push({ name: p.department, rows: [p] });
  }

  return (
    <div className="card my-team">
      <h2>พนักงานที่คุณมีสิทธิ์อนุมัติ</h2>
      <div className="hint">
        {people ? `${total} คน · ` : ''}แก้ไม่ได้ — แจ้งฝ่ายบุคคล
      </div>
      {error && <NoticeStack id="my-team"><NoticeRow tone="error" title={error} /></NoticeStack>}
      {people && total === 0 && <div className="hint team-empty">ยังไม่มีพนักงานที่คุณอนุมัติ</div>}
      {groups.map((g, i) => (
        <section key={`${g.name}-${i}`} className="team-group">
          <div className="team-head">{g.name || '—'} · {g.rows.length} คน</div>
          <ul className="team-list">
            {g.rows.map((p) => (
              <li key={p.id}>
                <span className="team-name">{p.name}</span>
                <span className="team-sub">{[p.code, p.position].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {paged && (
        <TablePager
          page={win.at}
          pageSize={pageSize}
          total={total}
          onPage={setPage}
          onPageSize={(n) => { setPageSize(n); setPage(1); }}
          label="พนักงานที่คุณมีสิทธิ์อนุมัติ"
          unit="คน"
          always
        />
      )}
    </div>
  );
}

// ── ธีมสีของหน้าจอ ──────────────────────────────────────────────────────────

const THEME_KEY = 'ot-theme';

/**
 * สว่าง / มืด / ระบบ — the one setting on this page that is not about
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
 * "ระบบ" (was ตามเครื่อง until 2026-10-08) is the absence of the key rather than a third stored value, so
 * somebody who has never touched this gets exactly what they got before the
 * setting existed — and following the machine keeps following it afterwards,
 * including when the machine changes its own mind at sunset.
 */
const THEMES = [
  { key: 'system', label: 'ระบบ', icon: 'monitor', hint: 'เปลี่ยนตามที่ตั้งไว้ในเครื่องหรือระบบปฏิบัติการ' },
  { key: 'light', label: 'สว่าง', icon: 'sun', hint: 'พื้นขาว แบบเดิมของระบบ' },
  { key: 'dark', label: 'มืด', icon: 'moon', hint: 'พื้นเข้ม สำหรับที่แสงน้อย' },
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
    <div className="card profile-theme">
      {/* "จำไว้เฉพาะเบราว์เซอร์นี้" was a hint beside the buttons and was squeezed
          to one word a line at 360px; it is a tooltip now, with the per-theme
          sentences on the buttons themselves. */}
      <h2 title="จำไว้เฉพาะเบราว์เซอร์นี้">ธีมสีหน้าจอ</h2>
      <div className="seg" role="group" aria-label="ธีมสีหน้าจอ">
        {THEMES.map((t) => (
          <button
            key={t.key}
            type="button"
            className={choice === t.key ? 'active' : ''}
            aria-pressed={choice === t.key}
            title={t.hint}
            onClick={() => pick(t.key)}
          >
            <Icon name={t.icon} className="seg-icon" />
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── read-only details ───────────────────────────────────────────────────────

function Details({ user }) {
  const company = COMPANIES.find((c) => c.key === user.company);
  const initials = (user.code || '').replace(/[^A-Za-z0-9]/g, '').slice(-2).toUpperCase();

  // รหัสพนักงาน ชื่อ และตำแหน่งอยู่หัวการ์ด — ที่เหลือเป็นข้อเท็จจริงสี่ช่อง
  const fields = [
    ['วันเกิด', user.birthDate ? thaiDate(user.birthDate) : null],
    // roleLabel — the one spelling. A local table of four stood here until
    // 2026-10-09 and drew กรรมการผู้จัดการ (and every บทบาท after 09-03) as —.
    ['บทบาท', user.role ? roleLabel(user.role) : null],
    ['แผนก', user.department?.name],
    ['บริษัท', company?.label],
  ];

  return (
    <div className="card">
      <div className="profile-id">
        <div className="avatar" aria-hidden="true">{initials}</div>
        <div>
          <h2>{user.name}</h2>
          <div className="hint">{[user.code, user.position].filter(Boolean).join(' · ')}</div>
        </div>
      </div>

      <dl className="profile-facts">
        {fields.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="hint profile-note">
        <span title="ข้อมูลมาจากทะเบียนพนักงานของฝ่ายบุคคล · ชื่อ-สกุลเป็นชื่อที่พิมพ์ลงใบ F-HR-027">
          แก้ไม่ได้ — แจ้งฝ่ายบุคคล
        </span>
      </div>
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
const PASSWORD_HELP = `อย่างน้อย ${MIN_LENGTH} ตัวอักษร · ใช้ไทย อังกฤษ ตัวเลข หรืออักขระพิเศษได้`;

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
 * เปลี่ยนรหัสผ่าน — on ข้อมูลส่วนตัว, and NOWHERE ELSE since 2026-09-04.
 *
 * It was on two screens: here, and the first-login gate in components/App.jsx,
 * which passed its own `hint` naming the issued password outright. That screen
 * was deleted the day the ข้ามไปก่อน button was added to it, so `hint` went with
 * it — a prop with no caller is a second way of drawing this form that nothing
 * draws.
 *
 * WHAT THE DELETED SCREEN SAID IS NOT DELETED WITH IT. It told people two
 * things: that รหัสผ่านเดิม is their own รหัสพนักงาน, and that other people can
 * read it. Both now hang off `pending` — set from `mustChangePassword`, so the
 * form says them to exactly the people the screen used to say them to, and to
 * nobody else. Somebody who chose their own password sees the plain form.
 *
 * `onDone` re-reads the session so the reminder strip on the landing tab goes
 * as soon as the flag does. Passing nothing is fine — the form then simply says
 * it worked.
 */
export function ChangePassword({ onDone, pending = false, jump = false, children = null }) {
  /**
   * THE CARD SCROLLS ITSELF INTO VIEW WHEN SOMETHING SENT SOMEBODY HERE FOR
   * IT — set by `jumpTo` on ProfileView, which is set by เปลี่ยนรหัสผ่าน on
   * the reminder strip and by nothing else.
   *
   * On the frame after mount, not during it: this component is mounted by
   * the tab switch that the press causes, so at the moment the effect runs
   * the cards above it — ข้อมูลของคุณ, ธีมสีหน้าจอ and, for a หัวหน้า,
   * ผู้รักษาการแทน — have not been laid out yet, and a scroll measured then
   * lands on a page that is about to grow underneath it. Same shape as the
   * jump into a row on ตรวจสอบรายเดือน; see `jump` in components/HrView.jsx.
   *
   * SMOOTH, EXCEPT WHERE SOMEBODY HAS ASKED FOR LESS MOTION. `matchMedia`
   * for the same reason that file gives: an imperative scroll has no CSS to
   * honour `prefers-reduced-motion` for it.
   *
   * How far down it lands is `.profile-password`'s `scroll-margin-top`, in
   * the stylesheet that owns the app bar it has to clear.
   */
  const cardRef = useRef(null);
  useEffect(() => {
    if (!jump) return;
    const still = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => {
      cardRef.current?.scrollIntoView({
        block: 'start',
        behavior: still ? 'auto' : 'smooth',
      });
    });
  }, [jump]);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  // ผลสำเร็จเป็น toast ตั้งแต่ 2026-10-10 (เคยเป็น `Alert kind="ok"` ในการ์ด ·
  // รายงาน UX ข.2) — `ok` เหลือหน้าที่เดียวคือซ่อนคำเตือนรหัสผ่านที่ HR ตั้งให้
  const [ok, setOk] = useState(false);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  /**
   * A BOX THAT WAS LEFT EMPTY SAYS SO ON ITS OWN, once it has been visited —
   * the login screen's rule (`.invalid` + a red `.field-note`, shown after the
   * fact and not while somebody is still on the way there). It replaced the
   * standing line "กรอกให้ครบทั้งสามช่อง" under the button, which told people
   * what the grey button was waiting for and was gone the moment it was no
   * longer true: the same fact, drawn once as a sentence and once as the
   * button's state.
   */
  const [touched, setTouched] = useState({});
  const visit = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const blank = (k, v) => touched[k] && v.length === 0;
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
    setOk(false);
    setBusy(true);
    try {
      await api.post('/employees/me/password', { current, next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setOk(true);
      toast('เปลี่ยนรหัสผ่านแล้ว · ครั้งต่อไปให้เข้าสู่ระบบด้วยรหัสผ่านใหม่');
      await onDone?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card profile-password" ref={cardRef}>
      {/* ONE LINE, NO FOLD — แบบ C, 2026-10-09. It was a `Disclosure` of
          five lines on a phone (…อ่านต่อ) from 2026-09-10. The two facts a
          reader needs WHILE TYPING went under their own boxes: รหัสผ่านเดิม
          says what the issued password is, and รหัสผ่านใหม่ checks its rule
          as an input validation (grey → ✓ green → red), asked for in as many
          words: *เงื่อนไขให้แสดงแบบ input validation*. What is left here is
          the one fact no box owns.

          หัวกับบรรทัดนี้อยู่ใน `<div>` เดียวกันตั้งแต่ 2026-10-11 กฎหัว+hint
          ของทั้งแอปจึงวางไว้บรรทัดเดียวกัน (จอแคบตกลงบรรทัดใหม่เอง) — ประหยัด
          ความสูงให้การ์ดนี้เท่าฝั่งข้อมูลกับธีม ดู `.profile-grid` */}
      <div className="profile-pw-head">
        <h2>เปลี่ยนรหัสผ่าน</h2>
        <div className="hint">เครื่องอื่นที่เข้าระบบค้างไว้ ยังใช้ได้จนหมดเวลา</div>
      </div>

      {/*
        ⚠ THIS BOX HAD A ▲/▼ FROM 2026-09-10 TO 2026-09-14, with
        `ot-pw-warn-fold` in localStorage behind it. Both went the way
        `ot-holiday-fold` went three days earlier: a notice that fits on one
        line has nothing left to put behind a press, and the press was the
        taller half of what it saved.

        WHAT THE FOLD HID was "— มีคนอื่นทราบด้วย จึงควรเปลี่ยนเป็นรหัสผ่านของคุณ
        เองที่ฟอร์มนี้". The first clause is a reason and stayed; the second
        pointed at the form directly underneath this Alert, which is the one
        thing on the screen that needs no pointing at.

        WHAT THE FOLD WAS CAREFUL TO LEAVE OUTSIDE IT is the middle of the
        sentence now — the password in use is the รหัสพนักงาน — and that is
        what the card's explanation leaned on to be foldable (until 2026-10-09,
        when it stopped folding and moved under the boxes).

        ไม่ใช่ `Alert` ในการ์ดแล้วตั้งแต่ 2026-10-11 — ผู้ใช้สั่งให้ย้ายไปกล่อง
        แจ้งเตือนบนสุดของหน้า: กล่องนี้ส่งแถวไปรวมในกล่อง `profile` ผ่าน
        `NoticePage` แบบเดียวกับ ผู้รับช่วงอนุมัติแทน · ประโยคเต็มอยู่ในหัวเรื่อง
        เพราะบนมือถือเห็นแค่หัวเรื่อง · ซ่อนได้ด้วย ซ่อน ของกล่อง แต่แถบหัวยังบอก
        ว่าซ่อนไว้ (design.md §5.1)
      */}
      {pending && !ok && (
        <NoticeStack id="password">
          <NoticeRow
            tone="warn"
            title="คุณยังใช้รหัสผ่านที่ฝ่ายบุคคลตั้งให้ ซึ่งคือรหัสพนักงานของคุณ และมีคนอื่นทราบด้วย"
          />
        </NoticeStack>
      )}
      {error && <Alert kind="error">{error}</Alert>}

      <form onSubmit={submit} className="profile-form">
        <div className="field">
          <label>รหัสผ่านเดิม</label>
          <PasswordInput
            placeholder="CURRENT PASSWORD"
            shown={showCurrent}
            onToggle={() => setShowCurrent((v) => !v)}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            onBlur={visit('current')}
            className={blank('current', current) ? 'invalid' : undefined}
            aria-invalid={blank('current', current) || undefined}
            {...NO_AUTOFILL}
            required
          />
          {blank('current', current)
            ? <div className="field-note error">กรุณากรอกรหัสผ่านเดิม</div>
            /* The line the deleted first-login screen carried, for whoever has
               never changed their password and does not know what to type. */
            : pending && <div className="field-note">รหัสพนักงานของคุณ (หรือรหัสที่ฝ่ายบุคคลแจ้ง)</div>}
        </div>

        <div className="field">
          <label>รหัสผ่านใหม่</label>
          <PasswordInput
            placeholder="NEW PASSWORD"
            shown={showNext}
            onToggle={() => setShowNext((v) => !v)}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            onBlur={visit('next')}
            className={blank('next', next) ? 'invalid' : undefined}
            aria-invalid={blank('next', next) || undefined}
            {...NO_AUTOFILL}
            minLength={MIN_LENGTH}
            required
          />
          {/* The rule as an input validation: grey before typing, ✓ green once
              the server's own rule passes, the rule's refusal in red when not. */}
          {blank('next', next) && <div className="field-note error">กรุณากรอกรหัสผ่านใหม่</div>}
          {!shape.ok && <div className="field-note error">{shape.error}</div>}
          {!blank('next', next) && shape.ok && (
            <div className={`field-note${next ? ' ok' : ''}`}>{next ? '✓ ' : ''}{PASSWORD_HELP}</div>
          )}
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
            onBlur={visit('confirm')}
            className={blank('confirm', confirm) ? 'invalid' : undefined}
            aria-invalid={blank('confirm', confirm) || undefined}
            {...NO_AUTOFILL}
            required
          />
          {blank('confirm', confirm) && <div className="field-note error">กรุณายืนยันรหัสผ่านใหม่</div>}
          {mismatch && <div className="field-note error">รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน</div>}
          {confirm.length > 0 && !mismatch && <div className="field-note ok">✓ ตรงกัน</div>}
        </div>

        {/* THE GREEN IS THE ANSWER TO "IS THIS READY?" — `.btn` fills green the
            moment `ready` turns true, and the app's disabled rule paints it grey
            with a border until then. What is missing is said by the boxes
            themselves (above), not by a sentence here: until 2026-10-08 a line
            "กรอกให้ครบทั้งสามช่อง" stood under the button. */}
        <div className="profile-submit">
          <div className="profile-actions">
            <button className="btn" disabled={busy || !ready}>
              <Icon name="save" />{busy ? 'กำลังบันทึก…' : 'บันทึก'}
            </button>
            {children}
          </div>
        </div>
      </form>
    </div>
  );
}
