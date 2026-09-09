'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, currentPeriod, periodLabel } from '@/lib/api.js';
import { Alert, PasswordInput, TipButton } from './common.jsx';
import Icon from './icons.jsx';
import { PickMonth } from './PickDate.jsx';
import { ToastHost } from './Toast.jsx';
import { BackProvider } from './nav.jsx';
// The panel the three pickers already open — portaled out of whatever would
// clip it, dismissed by Escape and by a press outside, and a bottom sheet below
// 860px. The phone bar's slot menus ARE that panel; see `BarSlot`.
import { Popover, PopFoot, useSheet } from './popover.jsx';
import { PolicyProvider } from './policyContext.jsx';
import EmployeeView from './EmployeeView.jsx';
import ApprovalQueue from './ApprovalQueue.jsx';
import HolidayBanner from './HolidayBanner.jsx';
import { BackupBanner } from './BackupBanner.jsx';
import HrView from './HrView.jsx';
import AccountingView from './AccountingView.jsx';
import DepartmentView from './DepartmentView.jsx';
import AdminView from './AdminView.jsx';
import LogSystem from './LogSystem.jsx';
import ProfileView from './ProfileView.jsx';
import PrintForm from './PrintForm.jsx';
import ManualView from './ManualView.jsx';
// `ROLES` and `readsOwnTeamOnly` were imported here for `PAGE_BY_ROLE`, which
// went on 2026-09-03 — see the note where it stood. `readsOwnTeamOnly` is still
// the rule, on the server, where the scoping it decides actually happens.
// `seesEveryRole` is read for ONE thing here and it is not a permission: it
// names ฝ่ายบุคคล and ผู้ดูแลระบบ, the two บทบาท whose phone bar is already
// full of other people's work, so their own พิมพ์ใบขออนุมัติ OT keeps its place
// in เพิ่มเติม rather than taking a fifth column. See `BAR_SLOTS`.
import { isSigner, roleLabel, seesEveryRole } from '@/lib/roles.js';

/**
 * The company mark, in the three places it appears.
 *
 * IT DRAWS THE MARK, NOT THE LOCKUP. `logo-mark.png` is the Pm on its own,
 * cropped from the supplied artwork by scripts/make-icon.js; `logo.png` is the
 * full lockup and is the SOURCE for that crop, not something any screen shows.
 *
 * The reason is visible the moment you look at the login panel: the badge is
 * 30–40 px and every one of these three places already writes “PRIMUS” in text
 * beside it. Drawing the lockup put the word in twice — once set cleanly in
 * type, and once about five pixels tall inside the badge, where it reads as a
 * green smudge under the mark. The mark alone is the correct half of a lockup
 * to use when the other half is already on the screen.
 *
 * WHAT IT DRAWS DEPENDS ON WHETHER THE FILE EXISTS. Without it, the two-letter
 * “Pm” tile this app shipped with. The fallback is not politeness — it is the
 * difference between a missing asset costing a slightly plainer badge and
 * costing every screen a broken-image icon in the top left corner, on a system
 * whose users cannot fix it and would reasonably read it as the app being
 * broken.
 *
 * `onError` rather than a build-time check, because the file is dropped in by
 * whoever has the artwork, on the machine that runs this, without a rebuild —
 * and a check that happened at build time would be answering the question at
 * the one moment nobody is asking it.
 *
 * The tile turns white when the mark loads (`has-logo`). The mark is green on
 * transparent, so on the dark sidebar and the green login panel it needs
 * something behind it; the “Pm” tile is green on those and needs the opposite.
 * One class, so the two can never be half-applied.
 */
function BrandMark({ className, alt = 'PRIMUS' }) {
  const [ok, setOk] = useState(true);
  return (
    <span className={`${className}${ok ? ' has-logo' : ''}`} aria-hidden={ok ? undefined : 'true'}>
      {ok
        ? <img src="/logo-mark.png" alt={alt} onError={() => setOk(false)} />
        : 'Pm'}
    </span>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/auth/me')
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="empty">กำลังโหลด…</div>;
  if (!session) return <Login onLogin={setSession} />;
  /**
   * THERE IS NO SCREEN BETWEEN SIGNING IN AND THE APP. Signing in lands on the
   * shell, for everybody, including an account still carrying the password
   * ฝ่ายบุคคล issued it.
   *
   * `FirstLogin` STOOD HERE UNTIL 2026-09-04 — ตั้งรหัสผ่านของคุณ, the only
   * screen an account with `mustChangePassword` could reach, with ออกจากระบบ
   * the only way out. It was asked for twice that day and withdrawn the same
   * day: first for a ข้ามไปก่อน button beside ออกจากระบบ, then — once that was
   * built and walked — for the page to go altogether ("ไม่ต้องเข้ามาหน้านี้แล้ว
   * ไม่เอาหน้านี้แล้ว"). A page whose every visitor is looking for the way past
   * it is a page that is only costing them a click.
   *
   * `mustChangePassword` IS STILL SET, STILL READ, AND STILL MEANS WHAT IT
   * MEANT. What changed is who it talks to and how loudly: it draws
   * `PasswordReminder` on the landing tab and a notice over the form on
   * ข้อมูลส่วนตัว, and it is cleared by exactly one thing — somebody typing a
   * new password. Nothing here writes to it, so nothing here can quietly turn
   * "this password is on every OT form in the building" into a settled matter.
   */
  return (
    <ToastHost>
      {/* Outside Shell, so every screen and every form opened over one reads
          the same copy — see components/policyContext.jsx for why this is not
          a prop. `session.policy` is what /auth/me sent. */}
      <PolicyProvider policy={session.policy}>
        {/* `onRefresh` re-reads the session in place, without a reload and
            without signing anybody out. One caller: เปลี่ยนรหัสผ่าน on
            ข้อมูลส่วนตัว, which is what clears `mustChangePassword` — and the
            reminder on the landing tab is drawn from that same field, so
            without this it would still be there after the thing it asks for
            had been done. */}
        <Shell
          session={session}
          onRefresh={async () => setSession(await api.get('/auth/me'))}
          onLogout={() => setSession(null)}
        />
      </PolicyProvider>
    </ToastHost>
  );
}

// ── the account still using the password ฝ่ายบุคคล issued ───────────────────

/**
 * คุณยังใช้รหัสผ่านที่ฝ่ายบุคคลตั้งให้อยู่ — the whole of what is left of the
 * first-login screen, and the only thing in the app that says this.
 *
 * WITHOUT IT, NOTHING WOULD. The screen that was deleted on 2026-09-04 was the
 * one place an employee was told that the password they are using is their
 * รหัสพนักงาน — a value printed on every ใบ OT in the building — and with the
 * screen gone the app would look, on every tab, exactly like an account whose
 * password only its owner knows. A notice that follows somebody is a smaller
 * thing than a page that stops them, which is the point; a notice that is not
 * there at all is a different decision, and it was not the one asked for.
 *
 * ON THE LANDING TAB, once — the same trade the backup strip and the holiday
 * announcement beside it make. A standing condition repeated on every screen
 * becomes furniture.
 *
 * It is not dismissible. `onClose` on an Alert is for a confirmation, and this
 * is a condition — it goes away when the password changes, which is what the
 * button is for.
 */
function PasswordReminder({ onOpenProfile }) {
  return (
    <Alert kind="warn">
      <strong>คุณยังใช้รหัสผ่านที่ฝ่ายบุคคลตั้งให้อยู่</strong>
      {' '}— รหัสนี้คือรหัสพนักงานของคุณ ซึ่งมีคนอื่นทราบด้วย
      {' '}แนะนำให้เปลี่ยนเป็นรหัสผ่านของคุณเองเมื่อสะดวก
      <div style={{ marginTop: 8 }}>
        <button className="btn ghost" onClick={onOpenProfile}>เปลี่ยนรหัสผ่าน</button>
      </div>
    </Alert>
  );
}

// ── login ───────────────────────────────────────────────────────────────────

function Login({ onLogin }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  /**
   * Whether the password is legible on the glass.
   *
   * Starts false every time the component mounts and is never persisted: a
   * preference that outlived the session would reveal the next person's typing
   * on a shared machine, and the two screens most likely to be logged into from
   * one — the ฝ่ายบุคคล account is shared by the whole department — are exactly
   * where that matters.
   */
  const [passwordShown, setPasswordShown] = useState(false);
  const [error, setError] = useState('');
  /**
   * The second line under a refusal, when the server has one to add.
   *
   * Kept apart from `error` rather than joined onto it, because they are two
   * different sentences: the first says what happened and is the same every
   * time, the second says what to do about it and only appears once somebody
   * has been getting it wrong for a while. See lib/loginThrottle.js.
   */
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * The two boxes this form refuses to send empty, and the mark each one wears.
   *
   * WHY THIS IS NOT `required` DOING THE WORK. Both inputs still carry
   * `required` — it is what tells a screen reader the field is not optional —
   * but the <form> carries `noValidate`, so the browser no longer halts the
   * submit and no longer draws its own bubble. That bubble was the thing to be
   * rid of: it is a tooltip in the browser's chrome rather than on this page,
   * worded by the browser and not by this app, it vanishes at the next click,
   * and it is the one mark on this screen that no stylesheet here can reach.
   * Everything else in this app that says "this is wrong" is ink under the
   * field it means, and now so is this.
   *
   * Keyed by field, so the two are independent. Submitting with neither filled
   * has to mark BOTH — which is exactly what the bubble could not do: it shows
   * one field at a time and leaves the rest to be found by guessing.
   */
  const [blanks, setBlanks] = useState({ code: false, password: false });
  const codeRef = useRef(null);
  const passwordRef = useRef(null);

  /**
   * Clear one field's mark the moment its box changes.
   *
   * On the keystroke and not on blur: the mark's whole claim is "this box is
   * empty", and that stops being true at the first character. Holding it until
   * focus moves would leave the page arguing with what the person can see.
   */
  function edit(name, set) {
    return (e) => {
      set(e.target.value);
      setBlanks((was) => (was[name] ? { ...was, [name]: false } : was));
    };
  }

  async function submit(e) {
    e.preventDefault();

    // Trimmed, because a box holding a space is empty as far as the server is
    // concerned — sending it spends one of the throttle's attempts to be told
    // what this sentence already says. See lib/loginThrottle.js.
    const missing = { code: !code.trim(), password: !password.trim() };
    if (missing.code || missing.password) {
      setBlanks(missing);
      // Whatever the last attempt was refused for, it was refused about a code
      // and a password that were both filled in. It is not about this.
      setError('');
      setHint('');
      // The first empty box, so the cursor lands on the work. Marking the
      // fields without moving focus leaves a keyboard several Tabs from the fix.
      (missing.code ? codeRef : passwordRef).current?.focus();
      return;
    }

    setBusy(true);
    setError('');
    setHint('');
    try {
      await api.post('/auth/login', { code, password });
      onLogin(await api.get('/auth/me'));
    } catch (err) {
      setError(err.message);
      setHint(err.payload?.hint || '');
      setBusy(false);
    }
  }

  return (
    <div className="login-split">
      <div className="login-brand">
        <div className="lockup">
          <BrandMark className="mark" />
          <div className="word">PRIMUS</div>
        </div>
        <div>
          <div className="kicker">OVERTIME SYSTEM</div>
          <h1>ระบบบันทึกและอนุมัติ<br />ค่าล่วงเวลา</h1>
          <p>
            บันทึกข้อมูลการทำงานล่วงเวลาสำหรับวันทำงานปกติ และวันหยุดเสาร์–อาทิตย์
            เพื่อส่งอนุมัติตามลำดับสายงาน
          </p>
        </div>
        <div className="ver">F-HR-027 Rev.4 · Primus Co., Ltd.</div>
      </div>

      <div className="login-form">
        <div className="inner">
          <h2>เข้าสู่ระบบ</h2>
          <p className="lede">กรุณากรอกรหัสพนักงานและรหัสผ่านเพื่อเข้าใช้งานระบบ</p>
          {/* `noValidate` turns off the browser's own “โปรดกรอกฟิลด์นี้”; the
              check it was doing now lives in `submit`, in this page's words. */}
          <form onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="login-code">รหัสพนักงาน · EMPLOYEE ID</label>
              <input
                id="login-code"
                ref={codeRef}
                className={blanks.code ? 'invalid' : undefined}
                aria-invalid={blanks.code || undefined}
                aria-describedby={blanks.code ? 'login-code-blank' : undefined}
                value={code}
                onChange={edit('code', setCode)}
                autoFocus
                required
                /* TWO COMPANIES, TWO PREFIXES — asked for on 2026-09-08.

                   It read `PM-0412`, which was one company and, since the real
                   roster was imported, a shape that is not on it any more:
                   counted on the live database that day, all 163 employee codes
                   are plain — 89 `PM…`, 74 `THT…`, not one hyphen. So the
                   example a เดมเทค employee was shown named the wrong company
                   in the wrong shape, on a screen whose only other word is
                   PRIMUS and which therefore says nothing about whether they
                   are in the right place at all.

                   THE HYPHEN IS STILL ACCEPTED and this changes no rule.
                   `codeMatcher` and `sameCode` in src/lib/employeeCode.js match
                   `PM-0620` against `PM0620` either way round — which is what
                   lets a placeholder name one shape without refusing the other.
                   A placeholder is an example, not a pattern.

                   ⚠ THE PASSWORD BOX IS NOT SO FORGIVING. `defaultPassword()`
                   keeps punctuation on purpose (see lib/employees.js), so an
                   account whose stored code has a hyphen has a first password
                   with the hyphen in it. That is what "ตามที่อยู่บนบัตร" in the
                   note under that box is doing, and it is why the note says
                   card and not this example. */
                placeholder="PM00111 / THT1111"
              />
              {blanks.code && (
                <div className="field-note error" id="login-code-blank">กรุณากรอกรหัสพนักงาน</div>
              )}
            </div>
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="login-password">รหัสผ่าน · PASSWORD</label>
              {/* This was written out here, and เปลี่ยนรหัสผ่าน then needed the
                  same control three more times. It is `PasswordInput` in
                  components/common.jsx now, which is also where the reasons it
                  is built the way it is are written down — the `type="button"`
                  that keeps the eye from submitting this form against the login
                  throttle, above all. Nothing about what draws here changed. */}
              <PasswordInput
                id="login-password"
                ref={passwordRef}
                className={blanks.password ? 'invalid' : undefined}
                aria-invalid={blanks.password || undefined}
                aria-describedby={blanks.password ? 'login-password-blank' : undefined}
                shown={passwordShown}
                onToggle={() => setPasswordShown((shown) => !shown)}
                value={password}
                onChange={edit('password', setPassword)}
                required
              />
              {blanks.password ? (
                <div className="field-note error" id="login-password-blank">กรุณากรอกรหัสผ่าน</div>
              ) : (
                /* THE LOGIN SCREEN ANSWERS "I HAVE NEVER LOGGED IN" AGAIN —
                   asked for on 2026-09-07, reversing part of the 2026-09-04
                   trim recorded in the .foot comment below. That trim was for
                   a formal, short page and this is the one sentence out of the
                   three it removed that cost something: without it the screen
                   is silent about a password the person has never been told,
                   and the only way to find out is to ring ฝ่ายบุคคล — who then
                   press รีเซ็ตรหัสผ่าน on an account that did not need it.

                   IT NAMES THE CASE ON PURPOSE. `defaultPassword` upper-cases,
                   and the code box does not care about case while this box has
                   to (`bcrypt.compare` is exact) — so somebody typing `pm00416`
                   into both gets in with neither. That asymmetry is invisible,
                   and this line is what makes it visible. It is the reason the
                   sentence is worth two clauses rather than one.

                   Saying the value out loud gives nothing away: it is printed
                   on every ใบ F-HR-027 and on the roster — see
                   README §รหัสผ่านแรกเข้า for the trade, and PasswordReminder
                   above for what keeps saying it after a sign-in. */
                /* "ทั้ง PM และ THT" JOINS THIS LINE TO THE EXAMPLE ABOVE IT —
                   2026-09-08, in the same breath as the placeholder. The box
                   now shows two prefixes and this is the sentence that says
                   what to do with them, so it may not read as though it is
                   about one company; two words is the whole cost.

                   The digits are NOT repeated here. They are three centimetres
                   above in the box that this sentence is about, and a note that
                   restates the example is a note people stop reading. */
                <div className="field-note">
                  เข้าใช้งานครั้งแรก · รหัสผ่านคือรหัสพนักงานของคุณ ทั้ง PM และ THT
                  {' '}พิมพ์เป็นตัวพิมพ์ใหญ่ตามที่อยู่บนบัตร
                </div>
              )}
            </div>
            {error && (
              <Alert kind="error">
                {error}
                {hint && <div style={{ marginTop: 4, fontSize: 12.5 }}>{hint}</div>}
              </Alert>
            )}
            <button className="btn" style={{ width: '100%', marginTop: 20 }} disabled={busy}>
              {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
            </button>
          </form>
          {/* One line, and it is the way out: somebody who knows their password
              reads nothing here, and somebody who does not is looking at the
              bottom of the card for who to ask.

              IT SAID MORE THAN THIS UNTIL 2026-09-04 — that the first password
              is the employee code, that the app asks for a new one at once, and
              that it works on a phone. Asked to make the page formal and short,
              and all three went. The first is the one that cost something: the
              login screen no longer answers "I have never logged in", so an
              account that has not signed in once now depends on ฝ่ายบุคคล
              saying it. After a sign-in the sentence is still on screen — the
              PasswordReminder strip above and the form in ProfileView both say
              the password is the employee code. Before one, only this line did. */}
          <div className="foot">
            หากพบปัญหาในการเข้าใช้งาน หรือต้องการรีเซ็ตรหัสผ่าน กรุณาติดต่อฝ่ายทรัพยากรบุคคล (HR)
          </div>
        </div>
      </div>
    </div>
  );
}

// ── shell ───────────────────────────────────────────────────────────────────

/**
 * `ROLE_LABEL` STOOD HERE UNTIL 2026-09-03 — a fourth copy of the บทบาท names,
 * written `{ employee, manager, hr, admin }` and never updated when บทบาท went
 * from four to seven.
 *
 * The whoami block at the foot of the sidebar reads it, so a การเงิน, a
 * ผู้จัดการแผนก and a ผู้จัดการฝ่าย saw a BLANK where their job title goes —
 * `ROLE_LABEL['finance']` is undefined — and a หัวหน้างาน saw one too, because
 * their key is `supervisor` now and this table still said `manager`. That is
 * the exact failure lib/roles.js was created to end, arriving in the one file
 * the migration did not look at.
 *
 * `roleLabel` from lib/roles.js is what draws it now, and it falls back to the
 * raw key rather than to nothing, so a row carrying a spelling from before a
 * migration is still readable on the screen used to correct it.
 */

/**
 * Page heading, the mono kicker under it, and — where a page has one — the one
 * line of standing context that belongs to the whole screen.
 *
 * THE THIRD FIELD IS OPTIONAL AND ALMOST ALWAYS ABSENT. It is for the fact that
 * is true of a screen every time it is opened and is about none of what is on
 * it: บันทึกระบบ is kept because the law says so, and that sentence was a
 * footer under every list, drawn on two tabs and read once. Behind the ⓘ it is
 * still one tap from the heading it belongs to and is no longer in the way of
 * the rows somebody came to read.
 *
 * A page whose note would change with its data does not belong here — this
 * table is a constant, and the heading is drawn before any screen has loaded.
 *
 * ── FIVE OF THESE WERE RENAMED ON 2026-08-31, AND THE OLD NAMES ARE STILL IN
 * THE SOURCE ──────────────────────────────────────────────────────────────
 *
 * Asked for as making the menu read more formally. This table and the `tabs`
 * array below are the two places a name is DECIDED; `.sidebar` and
 * `.mobile-nav` render the same `tabs`, so desktop and phone cannot disagree.
 *
 *   รอ HR ยืนยัน        → รออนุมัติ OT          (`confirm`)
 *   ตรวจสอบรายเดือน     → ตรวจสอบประจำเดือน     (`monthly`)
 *   สรุป OT ส่งบัญชี     → รายงาน OT ฝ่ายบัญชี   (`accounting`)
 *   สรุป OT แยกแผนก     → รายงาน OT แยกแผนก     (`departments`)
 *   บันทึกระบบ          → บันทึกประวัติระบบ      (`logs`)
 *
 * AND ONE OF THEM WAS RENAMED AGAIN ON 2026-09-08:
 *
 *   รายงาน OT ฝ่ายบัญชี  → รายงาน OT การเงิน     (`accounting`)
 *
 * so `accounting` has now worn three names, and the two older ones are both
 * still in the source under the rule spelled out below. ฝ่ายบัญชี was never a
 * บทบาท in this app; การเงิน is, and it is the บทบาท that reads this sheet
 * beside ฝ่ายบุคคล — the tab is now named after who opens it. The KEY is
 * still `accounting`, and so are the route, the CSV and the print sheet.
 *
 * TWO MORE ROUNDS THE SAME DAY, taking the other two bars. The หัวหน้างาน's:
 *
 *   รออนุมัติ           → รายการรออนุมัติ        (`approve`)
 *   สรุปทีม             → รายงาน OT ประจำทีม     (`monthly`, and see PAGE_BY_ROLE)
 *
 * and the พนักงาน's, which is the one that did not go the way it was asked —
 * see the note over the employee block in `tabs` for why the two names came
 * back swapped:
 *
 *   OT ของฉัน           → บันทึกและประวัติ OT    (`mine`)
 *   ใบ F-HR-027         → พิมพ์ใบขออนุมัติ OT     (`form`)
 *
 * THE KEYS DID NOT MOVE, and they are what everything else in the app is
 * written against — `tab`, `home`, `trail`, the guards, the tests. A label is
 * a string on a screen here and has never been an identifier.
 *
 * WHY GREPPING THE OLD NAMES STILL RETURNS ~180 LINES. They are comments and
 * dated notes reasoning about these screens, and they were left alone on
 * purpose: rewriting them would silently restate records like "reported on
 * 2026-08-28, the badge read 6 from ตรวจสอบรายเดือน" as things that were said
 * about a screen by a name it did not have that day. This block is the anchor
 * for all of them — one place that says which old name is which screen.
 *
 * FOUR STRINGS THAT LOOK LIKE THE OLD NAMES AND ARE NOT, all checked and all
 * deliberately untouched:
 *   · `PolicyStatus` in AdminView draws `⚠️ รอ HR ยืนยัน` beside
 *     `✓ HR ยืนยันแล้ว` — that is a POLICY VALUE waiting on a sign-off, not
 *     this queue.
 *   · `PrintFormBatch`'s `unmarked` scope is labelled `รอ HR ยืนยัน` in a list
 *     of document CONDITIONS beside ยังไม่อนุมัติ — a state of the rows on a
 *     sheet. "รออนุมัติ OT" next to "ยังไม่อนุมัติ" would read as a
 *     contradiction.
 *   · The confirm queue's own subtitle pairs ตรวจสอบรายเดือน with a หัวหน้า's
 *     ตรวจสอบรายวัน — a cadence, and the pair is the point.
 *   · `lib/accessLog.js` describes the log routes as เปิดดูบันทึกระบบ. Those
 *     strings are written into `otAccessLogs`, which is append-only; changing
 *     them splits the trail across two names for one screen and is a decision
 *     for whoever reads it, not a rename.
 */
const PAGE = {
  mine: ['บันทึกและประวัติ OT', 'MY OVERTIME'],
  // หัวหน้างาน only — ฝ่ายบุคคล's stand-in queue is `delegated` below, and no
  // account reaches both. Renamed with its tab on 2026-08-31; it read
  // 'รออนุมัติ' until then.
  approve: ['รายการรออนุมัติ', 'PENDING · MANAGER'],
  delegated: ['รออนุมัติแทน', 'PENDING · DELEGATED'],
  unsigned: ['ใบที่ไม่มีหัวหน้าเซ็นได้', 'PENDING · NO APPROVER'],
  confirm: ['รออนุมัติ OT', 'PENDING · HR'],
  /**
   * TWO KEYS, ONE COMPONENT — the month as the whole company, and the month as
   * the แผนก this person signs for.
   *
   * They were one key (`monthly`) until 2026-09-03, scoped by บทบาท on the
   * server and re-titled by a `PAGE_BY_ROLE` override on the screen. That held
   * while no บทบาท needed both readings, and การเงิน needs both: the whole
   * company to reconcile รายงาน OT ฝ่ายบัญชี against, and their own แผนก
   * because they sign its first signature. One key cannot be two tabs in one
   * bar, so the reading a screen is asking for is now the key rather than a
   * consequence of who is holding it.
   *
   * WHICH ALSO RETIRED THE OVERRIDE, and that is the better half of this. A
   * table of headings keyed by บทบาท had already gone stale once — it said
   * `manager:` after that spelling stopped being a บทบาท, and matched nobody
   * for a day without failing. Two keys carry their own two titles here, where
   * every other screen's title is, and nothing has to agree with anything.
   */
  team: ['รายงาน OT ประจำทีม', 'TEAM SUMMARY'],
  monthly: ['ตรวจสอบประจำเดือน', 'MONTHLY REVIEW'],
  accounting: ['รายงาน OT การเงิน', 'PAYROLL SUBMISSION'],
  departments: ['รายงาน OT แยกแผนก', 'DEPARTMENT SUMMARY'],
  form: ['พิมพ์ใบขออนุมัติ OT', 'PRINTABLE FORM'],
  admin: ['ตั้งค่าระบบ', 'SETTINGS & POLICY'],
  logs: [
    'บันทึกประวัติระบบ', 'SYSTEM & ACCESS LOG',
    'ระบบเก็บบันทึกตาม พ.ร.บ. คอมพิวเตอร์ มาตรา ๒๖ (ไม่น้อยกว่า 90 วัน)'
    + ' · เพิ่มได้อย่างเดียว แก้หรือลบย้อนหลังไม่ได้'
    + ' · ไม่เก็บเนื้อหาที่ส่งเข้ามาไม่ว่ารูปแบบใด รวมทั้งรหัสผ่าน'
    + ' · รวมอยู่ในไฟล์สำรองข้อมูลรายวัน',
  ],
  profile: ['ข้อมูลส่วนตัว', 'MY PROFILE'],
  /**
   * A SCREEN WITH NO `tabs.push` BEHIND IT — the second one, and `profile` is
   * the first. Both are reached from the foot of the two menus rather than from
   * the menu itself, and both are named here because a heading is a property of
   * the SCREEN: `PAGE[tab]` is what the appbar reads, and a key missing from it
   * draws a page with no title rather than failing.
   *
   * WHY IT IS NOT A TAB. The phone bar is four columns and a ผู้เซ็น fills all
   * four with one screen apiece — see `BAR_SLOTS`. A twelfth tab for every
   * บทบาท makes that bar five wide, or turns one of its presses into a sheet.
   * The manual is read once and referred to rarely; the queue is read every
   * day. See components/ManualView.jsx.
   */
  manual: ['คู่มือการใช้งาน', 'USER GUIDE'],
};

/**
 * `PAGE_BY_ROLE` STOOD HERE — a heading table keyed by บทบาท, existing for one
 * entry: the `monthly` tab, titled ตรวจสอบประจำเดือน for ฝ่ายบุคคล and
 * รายงาน OT ประจำทีม for a หัวหน้า, because one screen key served both jobs and
 * the server decided which by reading the บทบาท.
 *
 * IT WENT WITH THAT ARRANGEMENT ON 2026-09-03, when การเงิน were given both
 * readings at once (`team` and `monthly` are two keys in `PAGE` above). With
 * the reading named by the key, no title depends on who is holding it, and
 * there is nothing left for this table to override.
 *
 * ── WHY IT IS WORTH A PARAGRAPH RATHER THAN A DELETION ─────────────────────
 *
 * It had already failed once, silently, in the way a role-keyed table fails:
 * it read `manager: { monthly: … }`, `manager` stopped being a บทบาท that
 * morning, and the lookup then matched NOBODY — every signer pressed a tab
 * reading รายงาน OT ประจำทีม and arrived at a page headed ตรวจสอบประจำเดือน,
 * which is the exact fault the override had been added to fix. A lookup that
 * finds nothing is indistinguishable from a บทบาท with no override, so nothing
 * failed and nothing said anything.
 *
 * The repair that morning was to derive the keys from `ROLES`. The repair that
 * afternoon was to stop needing them: a heading is a property of the SCREEN,
 * and every other one in this app is written once in `PAGE`.
 */

/**
 * ── THE SIDEBAR'S THREE BLOCKS ─────────────────────────────────────────────
 *
 * Asked for on 2026-09-03: งานส่วนตัว and งานบริหาร/อนุมัติ had to stop being
 * one undivided column. The reason is the change of 2026-09-03 that put them in
 * one column in the first place — §2 was withdrawn, `maySubmitOt` became true
 * for every บทบาท, and from that morning a ฝ่ายบุคคล's bar opened with two
 * screens about their OWN OT and then continued into five about everybody
 * else's. Nothing marked where one job ended and the other began.
 *
 * WHAT THIS IS NOT: a second place the menu is decided. `tabs` below is still
 * the whole menu — who sees what, in what order, with which icon and badge —
 * and this table only says which heading a row is drawn under. A group is a
 * FIELD ON THE PUSH for exactly that reason: a lookup table keyed by tab would
 * be a second list to keep in step with the first, and the failure would be a
 * tab that quietly stopped being drawn.
 *
 * AND THE PHONE BAR IGNORES IT ENTIRELY. `.mobile-nav` maps flat `tabs` as it
 * always has — a bottom bar of five buttons has no room for headings and no
 * need of them. That is safe because the grouping is a PARTITION THAT PRESERVES
 * ORDER: every role's tabs already come out of the builder personal-first and
 * system-last, so filtering by group and concatenating gives back the same
 * sequence. The two bars still show one order; one of them draws lines in it.
 * `test/roleNavTabs.test.js` holds that, because it is the property that keeps
 * "the two bars cannot disagree" true.
 *
 * `parent` IS ON ONE GROUP AND ONE ONLY. ข้อมูลส่วนตัว collapses behind a
 * single row reading OT ส่วนตัว; the other two are flat lists under their
 * heading. Asked for that way — the personal pair is what every account
 * carries and what most accounts use least, so it is the pair worth folding.
 * A collapsible การอนุมัติ & รายงาน would be hiding the work somebody signed in
 * to do.
 */
const NAV_GROUPS = Object.freeze([
  { key: 'personal', label: 'ข้อมูลส่วนตัว', parent: { label: 'OT ส่วนตัว', icon: 'user' } },
  { key: 'work', label: 'การอนุมัติ & รายงาน' },
  /**
   * ASKED FOR AS ผู้ดูแลระบบ AND SHIPPED AS การตั้งค่าระบบ, which is the one
   * place this differs from the request, and the reason is a rule this app
   * already paid for once.
   *
   * ฝ่ายบุคคล reach ตั้งค่าระบบ — they maintain ทะเบียนพนักงาน, นโยบาย and
   * วันหยุด there — and they are not ผู้ดูแลระบบ. A heading naming a บทบาท
   * over rows that a DIFFERENT บทบาท can press is the `PAGE_BY_ROLE` fault
   * exactly: a หัวหน้า pressing รายงาน OT ประจำทีม and landing on a page headed
   * ตรวจสอบประจำเดือน, which is HR's job description and not theirs. It is
   * worse here, because in a system where บทบาท decides what a person may do,
   * a menu that files somebody under the wrong one is read as a statement about
   * their access.
   *
   * The other two headings name WHOSE WORK IS BEHIND THEM and stay right for
   * every reader; this one now names the SCREENS. It is the group's own name
   * from the request — การตั้งค่าระบบ — so the change is one heading, and
   * ผู้ดูแลระบบ is still what บันทึกประวัติระบบ is gated on.
   */
  { key: 'system', label: 'การตั้งค่าระบบ' },
]);

/**
 * Where a tab lands if its push forgot to say.
 *
 * A tab with no group would otherwise match no block and be drawn NOWHERE on a
 * desktop while still appearing on the phone — the exact "two bars disagree"
 * failure the array is built to prevent, arriving silently and on the device
 * nobody develops on. การอนุมัติ & รายงาน is where all but four of the app's
 * screens belong anyway, so the fallback lands somewhere defensible; the test
 * is what says the push should have been explicit.
 */
const DEFAULT_NAV_GROUP = 'work';

/**
 * ── THE PHONE BAR'S SLOTS — FIVE DECLARED, NEVER MORE THAN FOUR DRAWN ──────
 *
 * Asked for on 2026-09-04: the bottom bar had grown to eight buttons for
 * ผู้ดูแลระบบ and seven for ฝ่ายบุคคล, sharing 360px between them — about 45px
 * a tab, with a 22px glyph and a Thai label wrapping to three lines under it.
 * Four is what a bottom bar holds.
 *
 * WHAT IT IS NOT: a second menu. `tabs` is still the whole of who sees what, in
 * what order, with which label, icon and badge — the slots hold the SAME
 * entries, and a slot with more than one of them opens a sheet listing them
 * with the labels and glyphs they already wear. Nothing is hidden from a phone
 * that a desktop has, and nothing is named twice.
 *
 * `bar` IS A FIELD ON THE PUSH, exactly as `group` is, and for the reason
 * written over `NAV_GROUPS`: a lookup table keyed by tab would be a second list
 * to keep in step with the first, and the way it fails is a tab that quietly
 * stops being drawn. Two fields, two partitions, one array.
 *
 * AND THE TWO PARTITIONS AGREE ABOUT ORDER, which is what keeps the two bars
 * one menu. The slots are a REFINEMENT of the sidebar's three blocks —
 * `personal` splits into the two personal screens, `work` into the queues and
 * the reports, `system` becomes เพิ่มเติม — so
 * personal < form < queue < reports < more holds for every role, exactly as
 * personal < work < system does. `test/roleNavTabs.test.js` asserts the
 * ordering property rather than any one role's list.
 *
 * ── A SLOT WEARS A SHORT NAME, AND WHOSE IT IS DEPENDS ON WHAT IT HOLDS ────
 *
 * IT READ *"A SLOT HOLDING EXACTLY ONE TAB IS THAT TAB — its label, its glyph,
 * its badge, and one press to the screen"* until the 3rd round of 2026-09-04,
 * and *"A SLOT ALWAYS WEARS ITS OWN LABEL"* until the 5th. The press and the
 * glyph never moved in either round; the LABEL is what both were about.
 *
 * WHAT THE 3rd ROUND FIXED, reported with a picture of ตั้งค่าระบบ at 360px —
 * *"ยัดเยียดและตัวอักษรทับกัน"*. A screen's name in this app is a sentence:
 * บันทึกและประวัติ OT, พิมพ์ใบขออนุมัติ OT, รายการรออนุมัติ, รายงาน OT ประจำทีม.
 * Eighteen to nineteen characters. A quarter of a 360px bar is about 81px,
 * which is twelve or thirteen characters of Thai at 11px — so every one of a
 * หัวหน้างาน's four labels wrapped, and the round before it had just spent 10px
 * of line-height stopping the two lines colliding. The bar was 104px tall and
 * still looked full. Category names of nine to eleven characters ended that,
 * and NOTHING BELOW GIVES ANY OF IT BACK: every label on this bar is still
 * ten characters or fewer.
 *
 * WHAT THE 5th ROUND ASKED FOR, later the same day, is the ผู้เซ็น's bar named
 * screen by screen — ประวัติ OT · พิมพ์ใบ OT · รออนุมัติ · รายงานทีม. Those are
 * not the screens' own sentences; they are SHORT names at nine and ten
 * characters, so this is a change of WHICH short name a button wears, not a
 * return to the sentences that wrapped.
 *
 * THREE OF THE FOUR ARE THE SLOT'S OWN NAME and are written in the table below:
 * `personal` is ประวัติ OT, `form` is พิมพ์ใบ OT, `queue` was already
 * รออนุมัติ. Each of those slots holds the same screen or the same kind of
 * screen for every บทบาท, so one word over one glyph is true for every reader.
 *
 * `reports` IS THE ONE THAT CANNOT HAVE ONE TRUE NAME, and a per-tab `short` is
 * the whole of what was added for it. The slot holds รายงาน OT ประจำทีม for a
 * ผู้เซ็น and ตรวจสอบประจำเดือน · รายงาน OT ฝ่ายบัญชี · รายงาน OT แยกแผนก for
 * ฝ่ายบุคคล — one แผนก against every แผนก, which is the difference
 * `readsOwnTeamOnly` exists to draw. รายงานทีม over ฝ่ายบุคคล's three would say
 * something false about what the sheet shows. So the rule is: A SLOT HOLDING
 * ONE TAB MAY WEAR THAT TAB'S `short`, AND A SLOT HOLDING SEVERAL ALWAYS WEARS
 * ITS OWN. ฝ่ายบุคคล keep รายงาน; a ผู้เซ็น reads รายงานทีม.
 *
 * `short` IS NOT A SECOND PLACE A SCREEN IS NAMED. It sits ON THE PUSH beside
 * the label, the way `bar` and `group` do and for the reason written over
 * `NAV_GROUPS` — a lookup table keyed by tab is the shape that goes stale. It
 * is OPTIONAL and there is exactly one, on `team`; `test/roleNavTabs.test.js`
 * caps it at twelve characters so the next one cannot bring the wrapping back.
 *
 * ── AND `form` HAS A SLOT OF ITS OWN AGAIN — FOR EVERY บทบาท BUT TWO ───────
 *
 * It had one for a single round earlier the same day: the round that split the
 * bar into ส่วนตัว and จัดการทีม halves, which needed the two personal screens
 * adjacent to have a line to draw between them. The halves were withdrawn by
 * the report that asked for the redesign ("เอาหัวข้อแยกกลุ่ม ส่วนตัว /
 * จัดการทีม ออกจาก Bottom Bar เพื่อลดความสูงและความแออัด") and `form` went back
 * to เพิ่มเติม with them — the reason for the slot had gone with the halves.
 *
 * THE 5th ROUND IS A DIFFERENT REASON AND IT IS ABOUT THE ผู้เซ็น'S BAR: it
 * names พิมพ์ใบ OT as their second button and asks for no เพิ่มเติม at all —
 * *"ไม่ต้องมีเมนู เพิ่มเติม หรือ Dropdown ซ้อนทับอีกต่อไป"*. With `form` in slot
 * two, all four of a ผู้เซ็น's slots hold one tab each: four presses, four
 * screens, no sheet anywhere on the bar.
 *
 * ฝ่ายบุคคล AND ผู้ดูแลระบบ ARE THE EXCEPTION, AND IT IS ARITHMETIC RATHER THAN
 * PREFERENCE. Their queues fill one slot and their reports another; ตั้งค่าระบบ
 * and, for one of them, บันทึกประวัติระบบ still have to go somewhere. A slot
 * for `form` on top of those is a FIFTH column, on the one bar in this app that
 * cannot spend a pixel. So their own once-a-month print sheet keeps its place
 * in เพิ่มเติม — which is the trade `form` has always made and is the same one
 * it made when it lived there for everybody: the daily screen keeps a slot, the
 * monthly one goes to the back. Nobody's bar is over four buttons wide.
 *
 * SO THE FIFTH SLOT IS DECLARED AND THE BAR STILL DRAWS FOUR. An empty slot is
 * not drawn at all (see the derivation below), and no บทบาท fills five: a
 * พนักงาน has two, a ผู้เซ็น and การเงิน four, ฝ่ายบุคคล and ผู้ดูแลระบบ four
 * with sheets behind two of them. `test/roleNavTabs.test.js` counts them.
 *
 * `seesEveryRole` IS THE PREDICATE AND IT IS ASKED ON THE PUSH, where every
 * other role rule in this builder is asked. The derivation below still knows
 * nothing about บทบาท, which is the property that keeps the phone bar from
 * becoming a second menu.
 */
const BAR_SLOTS = Object.freeze([
  { key: 'personal', label: 'ประวัติ OT', icon: 'clock' },
  { key: 'form', label: 'พิมพ์ใบ OT', icon: 'document' },
  { key: 'queue', label: 'รออนุมัติ', icon: 'check' },
  { key: 'reports', label: 'รายงาน', icon: 'chart' },
  { key: 'more', label: 'เพิ่มเติม', icon: 'sliders' },
]);

/**
 * Where a tab lands if its push forgot to say — เพิ่มเติม, which is the slot
 * that can hold anything without lying about it. `DEFAULT_NAV_GROUP`'s note is
 * the rest of the reasoning; the test is what says the push should have been
 * explicit.
 */
const DEFAULT_BAR_SLOT = 'more';

/**
 * One button on the phone bar.
 *
 * TWO SHAPES, AND WHICH ONE IS DECIDED BY HOW MANY TABS ARE BEHIND IT. With
 * one, this is that tab: `.active` when it is the open screen, `aria-current`
 * saying the same thing to somebody who cannot see the green. With more, it is
 * a menu — `aria-haspopup`, `aria-expanded`, and `.current` while the open
 * screen is behind it.
 *
 * `.current` AND NOT `.active`, for the reason the sidebar's fold takes it: the
 * mark means *this is the page you are on*, and pressing this opens a list. Two
 * controls wearing one mark is how a person stops trusting the mark. The row
 * inside the sheet is the page, and it is the one that carries `aria-current`.
 */
function BarSlot({ slot, tab, onGo }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  /* Always true while this bar is drawn — `.mobile-nav` is `display: none`
     above 860px — and read rather than assumed, because the one thing that must
     not happen is a floating panel measured against a bar that is not there. */
  const sheet = useSheet();
  const single = slot.items.length === 1 ? slot.items[0] : null;
  const holds = slot.items.some((t) => t.key === tab);
  /* Closing puts the cursor back on the button, the way `usePicker` does for
     the pickers. Without it Escape drops the reader at the top of the page. */
  const close = useCallback(() => {
    setOpen(false);
    anchorRef.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={anchorRef}
        className={single ? (tab === single.key ? 'active' : '') : (holds ? 'current' : '')}
        /* The same pair the sidebar draws, off the same state — see the note
           there. Only a slot that IS a screen may claim to be the page. */
        aria-current={single && tab === single.key ? 'page' : undefined}
        aria-haspopup={single ? undefined : 'menu'}
        aria-expanded={single ? undefined : open}
        onClick={() => (single ? onGo(single.key) : setOpen((v) => !v))}
      >
        <span className="icon">
          <Icon name={slot.icon} />
          {/* Keyed on the number: React remounts the span when the count
              moves, which replays the CSS pop. At 0 the badge leaves instead.
              On a menu slot it is the SUM of what is behind it — the bar
              answers "is there anything for me over there", and over there is
              now a sheet rather than a screen. */}
          {slot.badge > 0 && <span className="count" key={slot.badge}>{slot.badge}</span>}
        </span>
        {/* The caret is INSIDE the label and not a third row of the column.
            The button is a column — glyph over label — so a sibling span would
            be a line of its own under the words, and the bar's height is its
            labels'. Inline, it sits after the last word and wraps with it.

            Only on a slot that opens a list. It is the whole of what tells a
            thumb that this press is a menu and not a screen: the green says
            where you are and cannot also say what a press will do. */}
        <span className="label">
          {slot.label}
          {!single && <span className="chev" aria-hidden="true">▾</span>}
        </span>
      </button>
      {open && !single && (
        <Popover
          anchorRef={anchorRef}
          sheet={sheet}
          shape={slot.items.length}
          label={slot.label}
          onClose={close}
          className="nav-pop"
        >
          <div className="nav-sheet-head">{slot.label}</div>
          <div className="nav-sheet" role="menu" aria-label={slot.label}>
            {slot.items.map((t) => (
              <button
                key={t.key}
                type="button"
                role="menuitem"
                className={tab === t.key ? 'active' : ''}
                aria-current={tab === t.key ? 'page' : undefined}
                onClick={() => { setOpen(false); onGo(t.key); }}
              >
                <span className="icon"><Icon name={t.icon} /></span>
                <span className="label">{t.label}</span>
                {t.badge > 0 && <span className="count">{t.badge}</span>}
              </button>
            ))}
          </div>
          {/* ปิด, on a sheet only. A floating panel is dismissed by pressing the
              page it is over; a sheet has a scrim over that page, and "press the
              dark part" is a convention rather than a control. */}
          <PopFoot sheet={sheet} onClose={close} />
        </Popover>
      )}
    </>
  );
}

/**
 * THE WHOLE MENU, UNDER THE AVATAR — a phone's answer to the sidebar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT EXISTS, AND IT IS WHERE THE GROUPING WENT
 *
 * Asked for on 2026-09-04: *"หากต้องการสลับโหมดระหว่าง ส่วนตัว กับ จัดการทีม ให้
 * ใช้การสลับผ่าน Top Bar / Profile Drawer ด้านบนแทน"*. The round before had put
 * those two headings ON the bottom bar, in two halves with a rule between them,
 * and the same report is what took them off again: a bottom bar has room for
 * four glyphs and one line of type under each, and a heading over them is 17px
 * of height on the one bar that cannot afford any.
 *
 * The grouping is a real thing and did not stop being one — it moved to the
 * place a phone has room for it. This is that place.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS `navGroups`, WHICH IS THE SIDEBAR'S OWN CUT
 *
 * ข้อมูลส่วนตัว · การอนุมัติ & รายงาน · การตั้งค่าระบบ, in that order, holding
 * exactly what the desktop sidebar draws under those same three headings — see
 * `NAV_GROUPS`. Not a fourth partition of `tabs` and not a list of its own: the
 * whole point of a drawer at this size is that a phone can reach the menu a
 * desktop has, and a second arrangement of it would be a second menu to keep in
 * step. `test/roleNavTabs.test.js` holds the drawer to reading `navGroups` and
 * nothing else.
 *
 * SO EVERY SCREEN IS HERE, including the four the bottom bar shows. That is not
 * duplication, it is the point: the bar is the four places a thumb goes all day
 * and the drawer is *everything, with the headings that say whose work it is*.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE AVATAR USED TO DO, AND WHY IT IS WORTH SAYING
 *
 * It went straight to ข้อมูลส่วนตัว. That screen is the first row of this
 * drawer's foot now, with ออกจากระบบ under it — the same two the sidebar's
 * `whoami` block has always carried, in the same order. Nothing is further away
 * than it was: ข้อมูลส่วนตัว was one press and is now two, and what the second
 * press buys is every other screen in the app at the same depth.
 *
 * A SHEET, NOT A SIDE PANEL. `Popover` in its below-860px form is what the app
 * already opens for the pickers and for เพิ่มเติม — a bottom sheet over a scrim,
 * dismissed by Escape, by a press outside and by ปิด. A drawer sliding in from
 * the edge would be a fourth kind of panel in an app that has one.
 */
function NavDrawer({ groups, tab, user, initials, onGo, onLogout }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const sheet = useSheet();
  const close = useCallback(() => {
    setOpen(false);
    anchorRef.current?.focus();
  }, []);
  /* How tall the sheet is asked to be — the same count `BarSlot` hands over,
     which is `Popover`'s only input for that. The two rows in the foot are part
     of what is on screen, so they are in the number. */
  const rows = groups.reduce((n, g) => n + g.items.length, 0) + 2;

  return (
    <>
      <button
        ref={anchorRef}
        className={`avatar${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="เมนูและข้อมูลส่วนตัว"
        title="เมนูและข้อมูลส่วนตัว"
      >
        {initials}
      </button>
      {open && (
        <Popover
          anchorRef={anchorRef}
          sheet={sheet}
          shape={rows}
          label="เมนู"
          onClose={close}
          className="nav-pop drawer-pop"
        >
          {/* WHO IS SIGNED IN, at the top, because this panel is opened from a
              button that shows two letters and nothing else. The sidebar's
              `whoami` block says the same three things in the same order and
              this is the phone's copy of it. */}
          <div className="drawer-who">
            <div className="avatar lg" aria-hidden="true">{initials}</div>
            <div className="drawer-who-text">
              <div className="nm">{user.name}</div>
              <div className="sub">{roleLabel(user.role)} · {user.code}</div>
            </div>
          </div>
          <div className="nav-sheet drawer-sheet" role="menu" aria-label="เมนู">
            {groups.map((g) => (
              <React.Fragment key={g.key}>
                {/* The heading the bottom bar gave up. `role="presentation"` —
                    a `<div>` inside a `role="menu"` is not a menu item, and
                    leaving it unlabelled would have a screen reader announce a
                    row that cannot be pressed. */}
                <div className="drawer-group" role="presentation">{g.label}</div>
                {g.items.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="menuitem"
                    className={tab === t.key ? 'active' : ''}
                    aria-current={tab === t.key ? 'page' : undefined}
                    onClick={() => { setOpen(false); onGo(t.key); }}
                  >
                    <span className="icon"><Icon name={t.icon} /></span>
                    <span className="label">{t.label}</span>
                    {t.badge > 0 && <span className="count">{t.badge}</span>}
                  </button>
                ))}
              </React.Fragment>
            ))}
            {/* คู่มือการใช้งาน — under its own heading and not under บัญชี,
                because it is neither: it is not one of the OT screens above and
                it is not something you do to the account. Every บทบาท gets this
                row, which is the whole of what "ให้ทุกสิทธิ์ดูได้" needs — there
                is no condition on it to get wrong. */}
            <div className="drawer-group foot" role="presentation">ช่วยเหลือ</div>
            <button
              type="button"
              role="menuitem"
              className={tab === 'manual' ? 'active' : ''}
              aria-current={tab === 'manual' ? 'page' : undefined}
              onClick={() => { setOpen(false); onGo('manual'); }}
            >
              <span className="icon"><Icon name="document" /></span>
              <span className="label">คู่มือการใช้งาน</span>
            </button>
            {/* บัญชีของฉัน — the pair the sidebar's foot carries, in its order.
                Separated by a rule rather than a heading: they are not a fourth
                block of the menu, they are what you do with the account rather
                than with the OT. */}
            <div className="drawer-group foot" role="presentation">บัญชี</div>
            <button
              type="button"
              role="menuitem"
              className={tab === 'profile' ? 'active' : ''}
              aria-current={tab === 'profile' ? 'page' : undefined}
              onClick={() => { setOpen(false); onGo('profile'); }}
            >
              <span className="icon"><Icon name="user" /></span>
              <span className="label">ข้อมูลส่วนตัว</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger"
              onClick={() => { setOpen(false); onLogout(); }}
            >
              <span className="icon"><Icon name="logout" /></span>
              <span className="label">ออกจากระบบ</span>
            </button>
          </div>
          <PopFoot sheet={sheet} onClose={close} />
        </Popover>
      )}
    </>
  );
}

function Shell({ session, onRefresh, onLogout }) {
  const { user } = session;
  const home = defaultTab(user.role);
  const [tab, setTab] = useState(home);
  const [counts, setCounts] = useState({
    pendingMgr: 0, pendingHr: 0, pendingMgrDelegated: 0, delegatedTeams: 0,
  });
  /**
   * `queueTab` STOOD HERE UNTIL 2026-09-03 — the sub-tab the queue screen was
   * to open on, set by the status line at the foot of ตรวจสอบรายเดือน when it
   * sent somebody to วันเกิดรอตรวจ. The queue screen has no sub-tabs now, so
   * there is nothing to steer and nothing to clear on the way out.
   */
  /**
   * Which section ตั้งค่าระบบ should open on, when something sent us there.
   * Cleared on leaving the tab (below), so it steers the one arrival it was set
   * for and the next plain click on the nav lands where it always does.
   */
  const [adminSection, setAdminSection] = useState(null);
  // Bumped by the mobile FAB; EmployeeView opens its form when it changes.
  const [formSignal, setFormSignal] = useState(0);

  /**
   * THE SPACER'S HEIGHT IS THE BAR'S OWN, MEASURED.
   *
   * `.mobile-nav-spacer` is what keeps the end of every screen out from under
   * the fixed bottom bar, and its height was a number written in the
   * stylesheet: 88px, the tallest the bar gets. The bar's height is its
   * LABELS' — six Thai words that wrap to three lines at 320px, two at 360 and
   * one above 600 — and 88 was the three-line case, chosen on 2026-08-26
   * because one number for the tallest case beat a breakpoint pinned to where
   * six words happen to rewrap.
   *
   * WHAT THAT LEFT, measured the same day at the foot of ตรวจสอบรายเดือน: 11px
   * of air at 360px and EXACTLY NONE at 320 — the last pixel of the page and
   * the first pixel of the bar were the same one. Nothing was hidden, and
   * anything that made the labels one line taller — a renamed tab, a larger
   * system font, a device this was not measured on — would have hidden it.
   *
   * So the bar reports its own height into `--nav-h` and the stylesheet asks
   * for that plus 12. A ResizeObserver rather than a measurement on mount,
   * because the height changes with no re-render behind it: a rotation, a
   * resize, a webfont arriving after first paint. The 88 stays in the
   * stylesheet as the `var()` fallback — it is what draws before this runs.
   */
  const navRef = useRef(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return undefined;
    const publish = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--nav-h', `${h}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty('--nav-h');
    };
  }, []);

  async function refreshCounts() {
    try { setCounts(await api.get('/entries/queue-summary')); } catch { /* not fatal */ }
  }
  useEffect(() => { refreshCounts(); }, [tab]);
  useEffect(() => { if (tab !== 'admin') setAdminSection(null); }, [tab]);

  /**
   * Rows just left a queue. Take them off the badge now and ask the server
   * after: the toast has already said it worked, and a number that sits
   * unchanged for the length of a round trip reads as the system not having
   * noticed. The refresh behind it is what makes the count right again when
   * somebody else was working the same queue.
   */
  function queueDone(stage, n = 1) {
    const key = stage === 'pending_hr' ? 'pendingHr'
      : stage === 'delegated' ? 'pendingMgrDelegated'
        : 'pendingMgr';
    setCounts((c) => ({ ...c, [key]: Math.max(0, (c[key] || 0) - n) }));
    refreshCounts();
  }

  // ── back stack ────────────────────────────────────────────────────────────
  // Two layers, unwound innermost first: sub-views open inside the current tab
  // (registered by the screens themselves, see nav.jsx), then the tabs visited
  // before this one. When both are empty, back means the first screen of this
  // person's role.
  const subViews = useRef([]);
  const [subDepth, setSubDepth] = useState(0); // mirrors the ref, to re-render
  const [trail, setTrail] = useState([]);

  const register = useCallback((fn) => {
    subViews.current = [...subViews.current, fn];
    setSubDepth(subViews.current.length);
    return () => {
      subViews.current = subViews.current.filter((h) => h !== fn);
      setSubDepth(subViews.current.length);
    };
  }, []);

  /** Switch tabs, remembering where we came from. Bounded, because a trail
      longer than a few steps stops matching anyone's idea of "back". */
  function goTab(next) {
    if (next === tab) return;
    setTrail((t) => [...t.slice(-7), tab]);
    setTab(next);
  }

  /**
   * Where the policy drift strip on the approval queues points. It is only ever
   * rendered for the roles that have this tab (see PolicyDriftBanner), so this
   * does not need a guard of its own.
   */
  function openPolicy() {
    setAdminSection('policy');
    goTab('admin');
  }

  /**
   * Where the "ยังไม่มีวันเกิดในระบบ" notices point.
   *
   * The birthday screens name a gap in ทะเบียนพนักงาน and used to end at
   * "(เฉพาะ Admin)" — accurate when the roster was Admin's alone, and now both
   * wrong and a dead end for the person most likely to be reading it. ฝ่ายบุคคล
   * maintain the roster, so the sentence names the tab and this takes them
   * there, on the right section, the way the policy drift strip already does.
   *
   * Guarded on the role rather than trusted to the caller: the same screens are
   * read by a หัวหน้า, who has no ตั้งค่าระบบ tab at all — see `tabs` above.
   * They get the plain sentence with no link, since sending them to a tab that
   * does not exist is worse than not offering.
   */
  const mayOpenRoster = ['hr', 'admin'].includes(user.role);

  function openRoster() {
    if (!mayOpenRoster) return;
    setAdminSection('employees');
    goTab('admin');
  }

  const canGoBack = subDepth > 0 || trail.length > 0;

  function goBack() {
    const open = subViews.current;
    if (open.length) { open[open.length - 1](); return; }
    if (trail.length) {
      setTab(trail[trail.length - 1]);
      setTrail((t) => t.slice(0, -1));
      return;
    }
    setTab(home);
  }

  /**
   * ONE NUMBER, EVERYWHERE.
   *
   * รออนุมัติ and รอ HR ยืนยัน held two piles of work until 2026-09-03 — requests
   * waiting for a signature, and birthdays waiting for somebody to check the
   * scan record — and the badge was the sum. The second pile no longer exists
   * (`birthdayPending` and its tab went with ฝ่ายบุคคล's birthday work), so what
   * is left is the requests and the open withdrawal asks below. It is still
   * counted the same way in `.sidebar` and `.mobile-nav` — those render the same
   * `tabs` array and never appear together, so two rules would agree on every
   * device and disagree the moment a window is dragged across 860px.
   *
   * IT FOLLOWED THE OPEN TAB FROM 2026-08-20 TO 2026-08-28, and that is what
   * this rewrite undoes. `queueBadge(key, ownPending)` took the current tab, a
   * `queueActive` state reported upward by the queue screen, and returned the open
   * tab's own pile while the screen was open and the sum from anywhere else.
   * Reported on 2026-08-28: the badge read 6 from ตรวจสอบรายเดือน and 3 after
   * pressing it, which is the same question answered two ways within one
   * press — and the direction of the change is the bad one, because the number
   * DROPS on arrival and a reader has no way to tell a badge that recounted
   * from three items that somebody else just cleared.
   *
   * THE READABILITY IT WAS SOLVING IS STILL SOLVED, by the thing that was
   * always solving it: the tab carries its own chip — ใบรอยืนยัน 3 — two
   * centimetres above the badge. The nav badge answers "is there anything for me
   * over there", which is a question about the screen; the chip answers "which
   * pile", which is a question about the tabs. A badge that answered the second
   * one had to stop answering the first.
   *
   * ── AND A SECOND PILE FROM 2026-09-03: คำขอถอนใบที่อนุมัติแล้ว ─────────────
   *
   * The card at the top of both these screens, and it was in nobody's count.
   * With no ใบ waiting, an employee could ask for
   * an approved entry to be withdrawn and the nav would carry no badge at all —
   * the one state where the badge's own question, *is there anything for me
   * over there*, was being answered wrongly rather than coarsely.
   *
   * `overlap` IS THE WHOLE OF WHY THIS TAKES AN ARGUMENT. An open request sits
   * on an entry that is `approved` or `pending_hr`, so on ฝ่ายบุคคล's screen the
   * `pending_hr` ones are already inside `counts.pendingHr` — the same entry,
   * the same person, the same screen. Added whole, the badge would count them
   * twice, and only on the days somebody happens to ask about an unconfirmed
   * ใบ, which is the kind of wrong that gets explained away rather than found.
   * A หัวหน้า's pile is `pendingMgr`, which no open request can be in, so they
   * pass nothing and nothing is taken off.
   *
   * NO CHIP GOES WITH IT, and the difference is what a chip is for. A chip
   * tells you what is behind a tab you cannot see — that is what วันเกิดรอตรวจ
   * had one for. This pile is a CARD at the top of the tab the badge already
   * lands you on, with its own count in its own heading. It cannot be missed
   * once you are there; the badge exists to get you there.
   */
  const queueBadge = (ownPending, overlap = 0) => ownPending
    + Math.max(0, (counts.withdrawalOpen || 0) - overlap);

  /**
   * ── THE MENU, ONE BLOCK PER ROLE ──────────────────────────────────────────
   *
   * `.sidebar` on a desktop and `.mobile-nav` on a phone both map this array
   * and nothing else. They are never on screen together, so there is no second
   * place a label, an icon, a badge or an ORDER could be decided — which is why
   * the phone bar has never needed a rule of its own and must not grow one.
   *
   * REORGANISED ON 2026-08-31 into the four blocks below, asked for as making
   * the role branching explicit. Nothing about who sees what changed: the
   * หัวหน้า's second tab used to be pushed seventy lines further down, after
   * the ฝ่ายบุคคล block it can never enter, so moving it up to sit with the
   * first one leaves every role's list in exactly the order it was already in.
   * A fifth block — การเงิน's — joined them on 2026-09-03.
   *
   * WHAT EACH ROLE ACTUALLY GETS, counted off `lib/session.js` where
   * `maySubmitOt` is true for EVERY บทบาท since 2026-09-03 (it read
   * `role === 'employee'` until then, and §2 barred หัวหน้างาน from filing at
   * all — see `Employee.maySubmitOt()` for what replaced that bar):
   *
   *   พนักงาน        2 — บันทึกและประวัติ OT · พิมพ์ใบขออนุมัติ OT
   *   หัวหน้างาน      4 — those two, then รายการรออนุมัติ · รายงาน OT ประจำทีม
   *   ผู้จัดการแผนก    4 — the same four; so does ผู้จัดการฝ่าย
   *   การเงิน         5 — the พนักงาน pair, รายการรออนุมัติ, then
   *                      ตรวจสอบประจำเดือน · รายงาน OT ฝ่ายบัญชี — ฝ่ายบุคคล's
   *                      own two screens, whole, and read-only
   *   ฝ่ายบุคคล       7 — the พนักงาน pair, then รออนุมัติ OT ·
   *                      ตรวจสอบประจำเดือน · รายงาน OT ฝ่ายบัญชี ·
   *                      รายงาน OT แยกแผนก · ตั้งค่าระบบ
   *   ผู้ดูแลระบบ      8 — those seven and บันทึกประวัติระบบ
   *
   * PLUS TWO THAT COME AND GO, both ฝ่ายบุคคล/ผู้ดูแลระบบ only and both
   * conditional on the state of the data rather than on a role: รออนุมัติแทน
   * while any team is covered, and ไม่มีหัวหน้าเซ็น while any request is stuck.
   * So "ฝ่ายบุคคล has seven" is the steady state and not a maximum — a covered
   * team makes it eight, and an admin with both faults open sees ten.
   *
   * THE FIRST TWO ARE EVERYBODY'S, and that is not a nav decision —
   * `Employee.maySubmitOt()` says who may file and `lib/session.js` hands this
   * component the answer. Writing a role list here would be that rule living in
   * two files, and it is the rule that changed most recently.
   */
  const tabs = [];

  // ── พนักงาน ───────────────────────────────────────────────────────────────
  // Both of these used to be pushed at opposite ends of this function with
  // three role blocks between them, which read as though something could come
  // between them in the bar. Nothing can: the two conditions are the same
  // condition, and every role in between is a role that fails it.
  /**
   * BOTH LABELS SAY WHAT THE SCREEN DOES, and on 2026-08-31 that had to be
   * argued for rather than assumed.
   *
   * The rename came in asking for `OT ของฉัน` → "ประวัติการทำ OT" and
   * `ใบ F-HR-027` → "ยื่นขออนุมัติ OT". Those two names are correct Thai for
   * the two things an employee does — and they are on the wrong tabs. Read
   * what each screen is:
   *
   * · `mine` is `EmployeeView` — the hero, `+ บันทึก OT ใหม่`, the FAB on a
   *   phone, and ประวัติการขอ OT under ดูประวัติทั้งหมด. FILING HAPPENS HERE.
   *   It is not a history screen; history is one of the two things on it.
   * · `form` is `MyForm` — pick a month, get `PrintForm`. It prints the sheet
   *   that is already filed, to be signed and handed to ฝ่ายบุคคล. NOTHING ON
   *   IT FILES ANYTHING.
   *
   * So the pair as asked would have swapped the two screens' meanings: a tab
   * reading ยื่นขออนุมัติ OT that cannot file, next to a tab reading ประวัติ
   * that is the only place you can. Raised, and the answer was to name each
   * screen after the work it actually does.
   *
   * `พิมพ์ใบขออนุมัติ OT` and not `ใบ F-HR-027`, for the reason the ฝ่ายบุคคล
   * button took the same day: the controlled-form code is what the sheet is
   * called in the filing cabinet, not what the person pressing the button
   * calls what they are about to print. The two now match word for word —
   * HR's says พิมพ์ใบขออนุมัติ OT ทุกคน, an employee's is their own copy of it.
   *
   * THE ICONS ARE THE ONES THEY ALREADY WORE. `clock` is the whole set's only
   * time glyph and there is no `history`; `document` is a sheet of paper with
   * ruled lines, which is exactly what comes out of the second tab. Adding a
   * `+` to it would promise the filing this tab does not do.
   */
  if (user.maySubmitOt) {
    tabs.push({ key: 'mine', label: 'บันทึกและประวัติ OT', icon: 'clock', group: 'personal', bar: 'personal' });
    // THE ONE ROW WHOSE SLOT DEPENDS ON WHO IS READING IT, and the only row
    // where the two cuts can disagree. `group` puts it in the sidebar's personal
    // fold beside `mine` for everybody. The phone gives it a slot of its own —
    // พิมพ์ใบ OT, the ผู้เซ็น's second button, asked for on 2026-09-04 — except
    // for the two บทบาท who would then be four slots deep before their own
    // ตั้งค่าระบบ had anywhere to go, and they keep it in เพิ่มเติม so that no
    // bar is five columns wide. See BAR_SLOTS for the arithmetic and the round
    // before this one, where it was in เพิ่มเติม for everybody.
    const formSlot = seesEveryRole(user.role) ? 'more' : 'form';
    tabs.push({ key: 'form', label: 'พิมพ์ใบขออนุมัติ OT', icon: 'document', group: 'personal', bar: formSlot });
  }

  // ── ผู้ที่เซ็นขั้นแรก · THE QUEUE AND THE REPORT THAT GOES WITH IT ────────
  /**
   * THESE TWO WERE THE WHOLE BAR UNTIL 2026-09-03, and the sentence that stood
   * here said why: "a หัวหน้า files no OT, so neither OT ของฉัน nor ใบ F-HR-027
   * is drawn for them". §2 was withdrawn that day — every บทบาท files its own
   * OT now (`Employee.maySubmitOt()`) — so the พนักงาน block above runs for
   * them too and these are the third and fourth tabs rather than the first two.
   * Nothing about the two themselves changed.
   *
   * BOTH LABELS WERE MADE LONGER ON 2026-08-31, asked for as reading more
   * formally, and each had a second candidate that was turned down for a
   * reason worth keeping:
   *
   * · รออนุมัติ → รายการรออนุมัติ, and NOT "รออนุมัติ OT" — that is now the
   *   ฝ่ายบุคคล tab three lines below. No one account sees both, so nothing
   *   would collide on a screen; two different screens under one name is a
   *   collision in every sentence written about them afterwards, which is the
   *   cost that actually gets paid. A หัวหน้า and ฝ่ายบุคคล talking about
   *   "รออนุมัติ OT" would be talking about two queues.
   *
   * · สรุปทีม → รายงาน OT ประจำทีม, and NOT "สรุป OT ภาพรวมทีม" — the other
   *   two report tabs in this app were renamed to รายงาน OT ฝ่ายบัญชี and
   *   รายงาน OT แยกแผนก on the same day, so this one takes the same
   *   `รายงาน OT …` shape and the three read as one family.
   *
   * THE ICONS ARE THE ONES THEY ALREADY WORE — `inbox` for a queue somebody
   * has to empty, `chart` for a sheet somebody reads. Both are in
   * `components/icons.jsx`; neither was added for this.
   */
  // All four บทบาท that hold a แผนก reach this since 2026-09-03 — the queue
  // and the team report belong to whoever signs the first step there, not to
  // หัวหน้างาน alone. Which ROWS each of them sees is `scopeFor` and the
  // routing matrix, on the server; this only decides that the tab exists.
  if (isSigner(user.role)) {
    tabs.push({
      key: 'approve', label: 'รายการรออนุมัติ', icon: 'inbox', group: 'work', bar: 'queue',
      badge: queueBadge(counts.pendingMgr),
    });
    /**
     * `team` — the same component ฝ่ายบุคคล's ตรวจสอบประจำเดือน draws, asking
     * the server for the แผนก this person signs for rather than the company.
     *
     * ALL FOUR SIGNERS, UNCONDITIONALLY, and that is what changed on
     * 2026-09-03: การเงิน was briefly excluded here, because the tab was keyed
     * `monthly` and their own block below pushes a `monthly` of its own, so
     * building both would have been two buttons in one bar opening one screen.
     * HR asked for การเงิน to have the team report as well — they sign
     * แผนกบัญชีและการเงิน's first signature and its month is theirs to read —
     * so the two readings became two keys and the exclusion had nothing left
     * to prevent. See `PAGE`.
     */
    // `short` — the ONE tab that carries a second, shorter name, and it is worn
    // only while this slot holds nothing else: a ผู้เซ็น's รายงาน slot is this
    // screen alone, so the button says รายงานทีม. การเงิน's holds three and
    // ฝ่ายบุคคล's holds three that are not this one, and both keep รายงาน. See
    // BAR_SLOTS for why the reports slot is the one that cannot have one name.
    tabs.push({ key: 'team', label: 'รายงาน OT ประจำทีม', short: 'รายงานทีม', icon: 'chart', group: 'work', bar: 'reports' });
  }

  // ── การเงิน · TWO MORE, AND BOTH ARE READ-ONLY ───────────────────────────
  /**
   * WHAT THIS BLOCK IS AND IS NOT. การเงิน have the four tabs above already —
   * their own บันทึกและประวัติ OT and พิมพ์ใบขออนุมัติ OT from the พนักงาน
   * block, and รายการรออนุมัติ plus รายงาน OT ประจำทีม from the signer block,
   * where they sign for แผนกบัญชีและการเงิน exactly as a หัวหน้างาน signs for
   * theirs. These two are what they have on top: the month as ฝ่ายบุคคล see it,
   * and the sheet that goes to their own desk.
   *
   * SO THEY HOLD THE SAME MONTH TWICE, AT TWO WIDTHS, and that is the point of
   * the pair rather than a duplicate. รายงาน OT ประจำทีม is the แผนก whose
   * first signature is theirs — what they are answerable for — and
   * ตรวจสอบประจำเดือน is every แผนก, which is what รายงาน OT ฝ่ายบัญชี on the
   * next tab is a summary of. Asked for on 2026-09-03, after the wide pair had
   * shipped without the narrow one.
   *
   * SO THE LABELS ARE ฝ่ายบุคคล'S, WORD FOR WORD, and that is the point rather
   * than an oversight. ตรวจสอบประจำเดือน here is not a team report under
   * another name — it is every แผนก and both payrolls, the same rows the
   * ฝ่ายบุคคล tab of the same name draws, because a การเงิน reconciling
   * รายงาน OT ฝ่ายบัญชี against the month has to be looking at the same month.
   * Two names for one screen is what makes a sentence about it unwritable.
   *
   * AND NOTHING ON EITHER OF THEM WRITES. `mayCorrectEntries` is what the
   * screens ask before they draw a control, and `editPermission` is what the
   * server answers with — one rule, in lib/entries.js, so the row's button and
   * the route's refusal cannot come apart. Asked for that way on 2026-09-03:
   * เห็นเมนู … แต่ไม่สามารถแก้ไขข้อมูลได้.
   *
   * `user.role === 'finance'` AND NOT `readsCompanyReports`, which ฝ่ายบุคคล and
   * ผู้ดูแลระบบ also answer true to — they build these same two tabs in their
   * own block below, with three more beside them, and this block must not be a
   * second place either of those two is decided.
   */
  if (user.role === 'finance') {
    tabs.push({ key: 'monthly', label: 'ตรวจสอบประจำเดือน', icon: 'calendar', group: 'work', bar: 'reports' });
    tabs.push({ key: 'accounting', label: 'รายงาน OT การเงิน', icon: 'banknote', group: 'work', bar: 'reports' });
  }

  // ── ฝ่ายบุคคล / ผู้ดูแลระบบ ──────────────────────────────────────────────
  /**
   * ฝ่ายบุคคล standing in for a หัวหน้า get a queue of their own.
   *
   * A manager needs no such tab — their รออนุมัติ already carries the covered
   * team's rows, each wearing a รับช่วง chip, because `scopeFor` widens by
   * department and theirs was narrow. HR's is not narrow, so widening it does
   * nothing and their existing screens would never show the manager's step at
   * all. This one asks for `scope=delegated`: the handed-over queue and
   * nothing else.
   *
   * Keyed on how many teams are covered rather than on how many rows are
   * waiting — an empty covered queue is still somebody's responsibility, and a
   * tab that vanished with its last row is a tab nobody would trust to be
   * there tomorrow.
   */
  if (['hr', 'admin'].includes(user.role) && counts.delegatedTeams > 0) {
    tabs.push({
      key: 'delegated',
      label: 'รออนุมัติแทน',
      icon: 'users',
      group: 'work',
      bar: 'queue',
      badge: counts.pendingMgrDelegated,
    });
  }
  /**
   * ใบที่ไม่มีใครเซ็นได้ — ผู้ดูแลระบบ only, and only while there are any.
   *
   * A DIFFERENT TAB FROM รออนุมัติแทน, not a widening of it, because the two
   * are answers to different questions. That one is a queue somebody was
   * HANDED, for a window that closes by itself; this one is a fault — requests
   * sitting at รอหัวหน้า in a แผนก with no หัวหน้า who covers them, which today
   * is every request anybody files in ADM. Merged, the standing responsibility
   * and the thing that is broken would wear one badge and one label, and
   * whichever of them was on screen you would not know which you were reading.
   *
   * IT VANISHES AT ZERO, unlike its neighbour. A covered queue with no rows in
   * it is still somebody's job today; a repaired fault is not, and a tab that
   * sat there permanently reading 0 would be the one nobody looks at on the day
   * it finally says 1.
   */
  if (user.role === 'admin' && counts.unsignedPending > 0) {
    tabs.push({
      key: 'unsigned',
      label: 'ไม่มีหัวหน้าเซ็น',
      icon: 'users',
      group: 'work',
      bar: 'queue',
      badge: counts.unsignedPending,
    });
  }
  if (['hr', 'admin'].includes(user.role)) {
    tabs.push({
      key: 'confirm',
      label: 'รออนุมัติ OT',
      icon: 'check',
      group: 'work',
      bar: 'queue',
      // The overlap is theirs alone: an open withdrawal request on a
      // `pending_hr` entry is already inside `pendingHr`. See `queueBadge`.
      badge: queueBadge(counts.pendingHr, counts.withdrawalOpenPendingHr),
    });
    tabs.push({ key: 'monthly', label: 'ตรวจสอบประจำเดือน', icon: 'calendar', group: 'work', bar: 'reports' });
    // Closing the month, not checking it — hence its own tab next to the
    // review rather than a mode inside it.
    tabs.push({ key: 'accounting', label: 'รายงาน OT การเงิน', icon: 'banknote', group: 'work', bar: 'reports' });
    // The other question the same month answers — how many hours each แผนก
    // worked, both payrolls counted together. Its own tab rather than a mode
    // inside สรุป OT ส่งบัญชี, because it is a different sheet for different
    // readers, not a different view of the submission.
    tabs.push({ key: 'departments', label: 'รายงาน OT แยกแผนก', icon: 'org', group: 'work', bar: 'reports' });
    // One label for both now that ฝ่ายบุคคล maintains ทะเบียนพนักงาน here as
    // well — "นโยบายและวันหยุด" named the two sections HR could use back when
    // the roster was Admin's alone, and a tab that undersells what is behind it
    // is how HR ends up asking IT to add a new hire.
    tabs.push({ key: 'admin', label: 'ตั้งค่าระบบ', icon: 'sliders', group: 'system', bar: 'more' });
  }
  /**
   * บันทึกระบบ — ผู้ดูแลระบบ AND NOT ฝ่ายบุคคล, which is why it is its own tab
   * rather than a seventh section inside ตั้งค่าระบบ.
   *
   * Every section on that screen is reachable by both roles; a section that
   * appeared for one of them would be a rule living in two files, and the
   * failure mode is the section quietly appearing for HR the day somebody adds
   * the next one. The endpoints refuse HR either way — see
   * app/api/logs/route.js for why the shared ฝ่ายบุคคล login is the reason —
   * and this keeps the screen and the server saying the same thing.
   */
  if (user.role === 'admin') tabs.push({ key: 'logs', label: 'บันทึกประวัติระบบ', icon: 'shield', group: 'system', bar: 'more' });

  async function logout() {
    await api.post('/auth/logout');
    onLogout();
  }

  /**
   * The same tabs, cut into the blocks `.sidebar` draws headings over.
   *
   * A FILTER AND NOT A SORT, which is the whole of why the phone bar can go on
   * ignoring this. `Array.prototype.filter` keeps the order it found things in,
   * and the builder above already emits personal-first and system-last for every
   * บทบาท, so concatenating the three blocks reproduces `tabs` exactly. Sort the
   * groups differently and the two bars would list one menu in two orders —
   * which is the thing `tabs` exists to make impossible.
   *
   * An EMPTY block draws nothing at all, heading included: พนักงาน have no
   * การอนุมัติ & รายงาน and a heading with no rows under it is a promise of a
   * screen they do not have.
   */
  const navGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: tabs.filter((t) => (t.group || DEFAULT_NAV_GROUP) === g.key) }))
    .filter((g) => g.items.length > 0);

  /**
   * The same tabs again, cut into the four slots the phone bar draws — the
   * second partition of the one array, and the same kind of cut: a filter,
   * which keeps the order it found things in. See `BAR_SLOTS`.
   *
   * THE GLYPH FOLLOWS A SLOT HOLDING ONE TAB, because a glyph is not a
   * sentence: a single-tab `personal` shows the clock `mine` wears rather than
   * the slot's own, so the bar is still the icons a reader recognises from the
   * sidebar.
   *
   * AND SO DOES THE LABEL, BUT ONLY AS FAR AS `short` — never the screen's own
   * name, which is the sentence that wrapped. A tab with no `short` leaves its
   * slot wearing the slot's name, which is what all but one of them do. See the
   * note over `BAR_SLOTS` for the two rounds this rule has been through and why
   * `team` is the one that carries a name of its own.
   *
   * THE BADGE IS THE SUM OF WHAT IS BEHIND IT, which is what the badge has
   * always meant: *is there anything for me over there*. Over there is a sheet
   * now rather than a screen, and each row in it carries its own count, so the
   * question is still answered at both depths — see `queueBadge`.
   */
  const barSlots = BAR_SLOTS
    .map((s) => ({ ...s, items: tabs.filter((t) => (t.bar || DEFAULT_BAR_SLOT) === s.key) }))
    .filter((s) => s.items.length > 0)
    .map((s) => ({
      ...s,
      icon: s.items.length === 1 ? s.items[0].icon : s.icon,
      label: (s.items.length === 1 && s.items[0].short) || s.label,
      badge: s.items.reduce((n, t) => n + (t.badge || 0), 0),
    }));

  /**
   * Whether OT ส่วนตัว is folded open — and `null` until somebody has said.
   *
   * THE THIRD STATE IS THE POINT. With a plain boolean the initial value would
   * have to be one answer for everybody, and the right answer differs by who
   * signed in: a พนักงาน lands ON one of these two screens and would meet a
   * closed fold hiding the page they are looking at, while ฝ่ายบุคคล land on
   * รออนุมัติ OT and want the column short. `null` means "nobody has pressed
   * it", and the fold then follows the tab — open exactly when the current
   * screen is inside it.
   *
   * A PRESS PINS IT AND KEEPS IT PINNED, in both directions, for the rest of the
   * session. That is the difference between a control and a suggestion: a fold
   * that re-opened itself the next time navigation happened to land inside it
   * would be undoing the press that closed it, which is the one thing a person
   * who pressed it is sure they did.
   */
  const [personalToggled, setPersonalToggled] = useState(null);
  const personalItems = navGroups.find((g) => g.parent)?.items || [];
  const personalOpen = personalToggled ?? personalItems.some((t) => t.key === tab);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        setSidebarCollapsed(localStorage.getItem('primus_sidebar_collapsed') === 'true');
      }
    } catch {}
  }, []);
  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem('primus_sidebar_collapsed', String(next));
        }
      } catch {}
      return next;
    });
  };

  // Read twice — by the FAB itself and by the spacer that has to keep the last
  // row out from under it.
  const showFab = user.maySubmitOt && tab === 'mine';

  // `PAGE_BY_ROLE[user.role]?.[tab] ||` came first here until 2026-09-03 — see
  // the note where that table used to be. One lookup now, and the empty triple
  // is still the last word so an unknown tab draws no heading rather than
  // throwing.
  const [title, meta, note] = PAGE[tab] || ['', '', null];
  /**
   * Whether the ⓘ beside the heading is showing its line.
   *
   * Shut on arrival and shut again on the way out: this is an answer to a
   * question somebody asked once, not a preference. Left open it would put the
   * sentence back at the top of every screen they moved to next, which is the
   * footer this replaced with an extra tap in front of it.
   */
  const [noteOpen, setNoteOpen] = useState(false);
  useEffect(() => { setNoteOpen(false); }, [tab]);
  /**
   * The two boxes a press can land in without meaning "shut it".
   *
   * THE BUTTON IS THE TRAP HERE, and it is worth the two refs. The dismiss
   * listens on `pointerdown`, which fires before `click` — so a press on the ⓘ
   * while the panel is open would close it on the way down and the button's own
   * onClick would open it again on the way up. Nothing visible happens, and the
   * panel becomes a thing that cannot be shut by the control that opened it.
   *
   * The panel itself is the second: a press inside it is somebody reading, and
   * on a phone it is also the start of a scroll.
   */
  const tipRef = useRef(null);
  const noteRef = useRef(null);
  useEffect(() => {
    if (!noteOpen) return undefined;
    const dismiss = (e) => {
      if (tipRef.current?.contains(e.target) || noteRef.current?.contains(e.target)) return;
      setNoteOpen(false);
    };
    /* Escape belongs to whatever is above this: a dialog opened over the page
       still closes first, so this only fires when the panel is the top thing. */
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) setNoteOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('keydown', onKey);
    };
  }, [noteOpen]);
  const initials = (user.code || '').replace(/[^A-Za-z0-9]/g, '').slice(-2).toUpperCase();

  return (
    <BackProvider register={register}>
    <div className={`shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className={`sidebar no-print${sidebarCollapsed ? ' collapsed' : ''}`}>
        <div className="brand">
          <div className="brand-main">
            <BrandMark className="mark" />
            <div className="brand-text">
              <div className="name">PRIMUS</div>
              <div className="kicker">OT SYSTEM</div>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleSidebar}
            aria-label={sidebarCollapsed ? 'ขยายแถบเมนู' : 'พับเก็บแถบเมนู'}
            title={sidebarCollapsed ? 'ขยายแถบเมนู' : 'พับเก็บแถบเมนู'}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {sidebarCollapsed ? <path d="m9 18 6-6-6-6" /> : <path d="m15 18-6-6 6-6" />}
            </svg>
          </button>
        </div>

        {/* Three blocks with a heading each, and the rows inside them are the
            same rows the phone bar draws flat — see `navGroups` and NAV_GROUPS.

            ONE BUTTON IS WRITTEN HERE, ONCE. The fold does not get a copy of
            the row markup for its children: it decides whether the list is
            rendered, not what a row looks like. Two copies of this button is
            how one of them keeps an `active` rule the other loses, which is
            the failure test/navActiveTab.test.js counts occurrences to catch. */}
        <nav className="nav">
          {navGroups.map((g) => (
            <div className="nav-group" key={g.key}>
              {/* Not a heading element. It labels a list of links inside a
                  <nav> that already has one; an <h3> here would put a level
                  into the document outline for something that is a divider. */}
              <div className="nav-group-label">{g.label}</div>
              {g.parent && (
                <button
                  type="button"
                  /* `current` and deliberately NOT `active`. This row is not a
                     screen — pressing it folds a list — so it must never wear
                     the mark that means "the page you are on". What it says,
                     and only while the fold is shut, is that the page you are
                     on is behind it. */
                  className={`nav-parent${!personalOpen && personalItems.some((t) => t.key === tab) ? ' current' : ''}`}
                  aria-expanded={personalOpen}
                  aria-controls={`nav-${g.key}`}
                  onClick={() => setPersonalToggled(!personalOpen)}
                >
                  <span className="icon"><Icon name={g.parent.icon} /></span>
                  <span className="label">{g.parent.label}</span>
                  <span className="chev" aria-hidden="true">›</span>
                  <span className="nav-tip">{g.parent.label}</span>
                </button>
              )}
              {(!g.parent || personalOpen) && (
                <div className={`nav-items${g.parent ? ' sub' : ''}`} id={`nav-${g.key}`}>
                  {g.items.map((t) => (
                    <button
                      key={t.key}
                      className={tab === t.key ? 'active' : ''}
                      /* `aria-current` says what the colour says.

                         The open tab is marked by a fill here and by green type
                         on the phone bar, and neither of those reaches somebody
                         who is not looking at the screen — so the one button
                         that is the page they are on was, to a screen reader,
                         the fourth button in a row of eight. Read off the same
                         `tab === t.key` as the class, so the two can never come
                         apart. */
                      aria-current={tab === t.key ? 'page' : undefined}
                      onClick={() => goTab(t.key)}
                    >
                      <span className="icon"><Icon name={t.icon} /></span>
                      <span className="label">{t.label}</span>
                      {/* Keyed on the number: React remounts the span when the
                          count moves, which replays the CSS pop. The queue
                          emptying is the one change worth noticing out of the
                          corner of an eye, and at 0 the badge leaves instead. */}
                      {t.badge > 0 && <span className="count" key={t.badge}>{t.badge}</span>}
                      <span className="nav-tip">{t.label}{t.badge > 0 ? ` (${t.badge})` : ''}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* ── คู่มือการใช้งาน — A ROW IN THE MENU THAT IS NOT A TAB ──────────
            WHY IT IS NOT ONE. `tabs` carries two partitions with it, and the
            phone's is capped: four columns, and a ผู้เซ็น already fills all
            four with one screen apiece (see `BAR_SLOTS`). A twelfth push for
            every บทบาท makes that bar five wide, or turns one of its presses
            into a sheet — paid every day, to reach a page somebody opens twice.
            So this is `PAGE.manual` reached from the foot of both menus, the
            way ข้อมูลส่วนตัว has always been.

            NO บทบาท CONDITION ON IT, HERE OR IN THE DRAWER. That is the whole
            of "ให้ทุกสิทธิ์ดูได้" — there is no gate to get wrong, and the
            screen itself says which of the pages it describes a reader may not
            have.

            A SECOND `.nav` RATHER THAN A ROW INSIDE THE FIRST. The block above
            maps `navGroups` and nothing else, and that is a property worth
            keeping — test/navActiveTab.test.js reads that `<nav>` and counts
            the sources of `'active'` in it, which is how the two bars are held
            to one state. Wearing the same class, this row is the same object as
            the rows above it: same height, same glyph slot, same green when it
            is the page, same tooltip when the rail is collapsed, and none of it
            written twice. It sits under the last group rather than on the floor
            because `.sidebar-foot`'s auto margin owns the floor; the space
            between them is the seam that says the foot is about the person. */}
        <nav className="nav nav-help" aria-label="ช่วยเหลือ">
          <button
            className={tab === 'manual' ? 'active' : ''}
            aria-current={tab === 'manual' ? 'page' : undefined}
            onClick={() => goTab('manual')}
          >
            <span className="icon"><Icon name="document" /></span>
            <span className="label">คู่มือการใช้งาน</span>
            <span className="nav-tip">คู่มือการใช้งาน</span>
          </button>
        </nav>

        <div className="sidebar-foot">
          {/* The whoami block is the way into ข้อมูลส่วนตัว — no nav entry of
              its own, since it is where a person already looks for themselves. */}
          <button
            type="button"
            className={`whoami ${tab === 'profile' ? 'active' : ''}`}
            onClick={() => goTab('profile')}
            title="ข้อมูลส่วนตัว"
          >
            <div className="avatar">{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="n">{user.name}</div>
              <div className="r">{roleLabel(user.role)} · {user.department?.name || '—'}</div>
            </div>
            <span className="chev">›</span>
            <span className="nav-tip">{user.name}</span>
          </button>
          <button className="signout" onClick={logout}>ออกจากระบบ</button>
        </div>
      </aside>

      <div className="body">
        <header className="appbar no-print">
          {/* On a phone there is no sidebar and no browser chrome worth
              tapping, so the mark is the only fixed thing on screen — which
              makes it the natural place to put "out of here". It unwinds one
              screen at a time and, with nothing left to unwind, returns to the
              first screen of this person's role. The label says which of the
              two it is about to do rather than naming the logo. */}
          <button
            type="button"
            className="mark-btn"
            onClick={goBack}
            aria-label={canGoBack ? 'ย้อนกลับ' : 'กลับหน้าหลัก'}
            title={canGoBack ? 'ย้อนกลับ' : 'กลับหน้าหลัก'}
          >
            {/* The button already carries the label, so the mark inside it is
                decorative either way — `alt=""` keeps a screen reader from
                reading "PRIMUS" over "ย้อนกลับ". */}
            <BrandMark className="mark-sm" alt="" />
          </button>
          <div className="grow">
            <div className="title-line">
              <div className="title">{title}</div>
              {/* The app's own tip control, wearing an `i`. It is the same 17px
                  circle that carries a `?` on every form field — same ink, same
                  focus ring, same keys — because "there is something to explain
                  here" is one promise and should not be two controls. The glyph
                  is the difference between the two things being explained: a
                  field asks what to type, a page heading does not ask anything.

                  It holds the sentence in `title` for a pointer and toggles the
                  line below for a thumb, which is the whole reason it is a
                  button and not a hover — a phone has no hover to give. */}
              {note && (
                <span className="tip-wrap" ref={tipRef}>
                  <TipButton
                    glyph="i"
                    text={note}
                    of={title}
                    open={noteOpen}
                    onToggle={() => setNoteOpen((v) => !v)}
                  />
                </span>
              )}
            </div>
            <div className="meta">{meta}</div>
          </div>
          {/* On mobile the sidebar is gone, and since 2026-09-04 this is the way
              to the WHOLE of it: the three headed blocks, then ข้อมูลส่วนตัว and
              ออกจากระบบ. It went straight to ข้อมูลส่วนตัว until then — see the
              note over `NavDrawer` for what that press buys and what it costs.
              The grouping the bottom bar gave up that day is what this holds. */}
          <NavDrawer
            groups={navGroups}
            tab={tab}
            user={user}
            initials={initials}
            onGo={goTab}
            onLogout={logout}
          />
          {/* OVER THE PAGE, NOT IN IT. Inside the bar because the bar is what it
              is anchored to — `.appbar` is sticky, which makes it the containing
              block for this, so the panel hangs under the heading it belongs to
              and travels with it when the page scrolls.

              It closes on a press anywhere outside itself and the ⓘ, on Escape,
              and on leaving the screen; see the effect at `noteOpen`. */}
          {note && noteOpen && (
            <div className="page-note" ref={noteRef} role="note">{note}</div>
          )}
        </header>

        <main>
          <div className="page">
            {/*
              สถานะการสำรองข้อมูล — บนหน้าแรกของ ฝ่ายบุคคล และ admin เท่านั้น

              On the landing tab and nowhere else. A missed backup is a standing
              condition rather than an event: it is equally true on every screen,
              and repeating it on each of them is how a warning becomes furniture
              — which is exactly what happened to the line the scheduled task has
              written to backups/backup.log every night since 18 August. The
              first screen after login is where it is read rather than scrolled
              past.

              Renders nothing for the other roles, and nothing at all while the
              nightly job is doing its work — including when the only copy is on
              the same disk as the database, which the endpoint still reports
              and this strip stopped announcing on 2026-08-24. What is left is a
              job that failed. See components/BackupBanner.jsx; there is no
              green state either.
            */}
            {tab === home && (
              <div style={{ padding: '0 18px' }}>
                <BackupBanner user={user} />
              </div>
            )}
            {/*
              คุณยังใช้รหัสผ่านที่ฝ่ายบุคคลตั้งให้อยู่ — ทุกบทบาท

              THE ONLY PLACE THIS IS SAID, since ตั้งรหัสผ่านของคุณ was deleted
              on 2026-09-04. Every account carrying the flag now signs straight
              into the shell, so a person whose password is their own
              รหัสพนักงาน — a value printed on every ใบ OT — meets this strip or
              meets nothing.

              On the landing tab, the same rule the strip above and the
              announcement below follow: a standing condition drawn on every
              screen becomes furniture.
            */}
            {tab === home && user.mustChangePassword && (
              <div style={{ padding: '0 18px' }}>
                <PasswordReminder onOpenProfile={() => goTab('profile')} />
              </div>
            )}
            {/*
              ประกาศวันหยุดบริษัท — ทุกบทบาท ไม่ใช่แค่พนักงาน

              Asked for on 2026-08-28: "ทุกคนที่อยู่ในระบบคือแจ้งหมดเหมือน
              พนักงาน". The announcement was mounted only inside EmployeeView, so
              a หัวหน้า, ฝ่ายบุคคล or admin who never opened หน้า OT ของฉัน was
              never told which days the company is shut — and they are the people
              answering the requests those days produce.

              ON THE LANDING TAB, which is the same rule the backup strip above
              follows and for the same reason: this is a standing announcement,
              equally true on every screen, and a notice repeated on all of them
              becomes furniture. `home` differs per role — รออนุมัติ for a
              หัวหน้า, รอ HR ยืนยัน for ฝ่ายบุคคล, ตั้งค่าระบบ for admin — so each
              of them meets it on the first screen after they sign in, which is
              what an employee already got on theirs.

              EXCEPT WHEN home IS หน้า OT ของฉัน, because EmployeeView draws its
              own there and two would be two. That is not a duplicate rule: the
              employee screens can say WHICH month they are showing and pass it
              (page back to July and the banner announces July), and this mount
              has no month picker to read. Whoever lands here gets today's.
            */}
            {tab === home && home !== 'mine' && (
              <div style={{ padding: '0 18px' }}>
                <HolidayBanner />
              </div>
            )}
            {tab === 'mine' && <EmployeeView user={user} onChanged={refreshCounts} openSignal={formSignal} />}
            {/* ONE LIST AGAIN SINCE 2026-09-03. This was `QueueTabs` — ใบรอยืนยัน
                beside วันเกิดรอตรวจ — and with the birthday pile gone the
                wrapper was a tab bar with one tab in it. components/QueueTabs.jsx
                was deleted rather than left holding a single child. */}
            {tab === 'approve' && (
              <ApprovalQueue
                user={user}
                stage="pending_mgr"
                onChanged={queueDone}
                onOpenPolicy={openPolicy}
              />
            )}
            {/* The covered queue stays a single list: a ฝ่ายบุคคล standing in for
                a หัวหน้า already sees every birthday in the company on their own
                รอ HR ยืนยัน, so a second copy here would be the same rows twice. */}
            {tab === 'delegated' && <ApprovalQueue user={user} stage="pending_mgr" delegatedOnly onChanged={queueDone} onOpenPolicy={openPolicy} />}
            {/* The same queue component, asking the server for a different
                list — `scope=unsigned`. Not a second copy of the screen: every
                rule about what a row shows and which buttons it earns is the
                same one, and the one thing that differs (a reason is compulsory
                here) is a fact about the rows, which the component reads off
                the mode it was given. */}
            {tab === 'unsigned' && <ApprovalQueue user={user} stage="pending_mgr" unsignedOnly onChanged={queueDone} onOpenPolicy={openPolicy} />}
            {tab === 'confirm' && (
              <ApprovalQueue
                user={user}
                stage="pending_hr"
                onChanged={queueDone}
                onOpenPolicy={openPolicy}
              />
            )}
            {/* ONE COMPONENT, TWO TABS, and the `key` is what keeps them two
                screens rather than one that changes under the reader.

                Without it React reuses the mounted `HrView` when the tab
                changes between these two — same type, same position — so the
                month picker, สถานะที่นับ, the search box, the page of cards and
                any open sub-view all carry across from a table of the whole
                company onto a table of one แผนก. The prop changes, the request
                is re-made, and for one paint the old rows sit under the new
                heading. Keyed, the second tab is a fresh screen, which is what
                a person pressing a different button in the bar is asking for.

                `scope` decides which month it asks the server for; see
                components/HrView.jsx. Everything else about the screen — the
                columns, the exports, the read-only rule — is the same on both,
                because it is the same screen. */}
            {(tab === 'monthly' || tab === 'team') && (
              <HrView
                key={tab}
                user={user}
                scope={tab === 'team' ? 'team' : 'company'}
                onOpenRoster={mayOpenRoster ? openRoster : null}
              />
            )}
            {tab === 'accounting' && <AccountingView />}
            {tab === 'departments' && <DepartmentView />}
            {tab === 'form' && <MyForm />}
            {tab === 'admin' && <AdminView user={user} initialSection={adminSection} />}
            {tab === 'logs' && <LogSystem />}
            {tab === 'profile' && (
              <ProfileView user={user} onPasswordChanged={onRefresh} onLogout={logout} />
            )}
            {tab === 'manual' && <ManualView />}
          </div>
        </main>

        {/* The spacer clears whatever is pinned to the bottom of THIS screen.
            That is the nav bar everywhere, and on หน้า OT ของฉัน the FAB as
            well — which floats 92px up and is 58 tall, so a spacer sized for
            the nav alone left the last row's status chip underneath it.

            How tall it is for the BAR is no longer written down anywhere: the
            bar measures itself into `--nav-h` — see the observer above. */}
        <div className={`mobile-nav-spacer no-print${showFab ? ' with-fab' : ''}`} />

        {/* FOUR BUTTONS AT MOST, FLAT, and they hold the same `tabs` the sidebar
            draws — see `BAR_SLOTS` and the derivation above. A slot with one tab
            behind it goes straight to that screen; a slot with more opens a
            bottom sheet listing them under the names and glyphs they already
            wear. Every button is a short label on one line: the slot's own,
            or — where the slot holds one tab that carries a `short` — that
            screen's. A ผู้เซ็น's four are ประวัติ OT · พิมพ์ใบ OT · รออนุมัติ ·
            รายงานทีม, one press to a screen apiece and no sheet on the bar.

            THE ส่วนตัว / จัดการทีม HEADINGS STOOD HERE FOR ONE ROUND on
            2026-09-04 — two `.nav-side` halves with a rule between them — and
            were withdrawn the same day by the report that asked for this one:
            *"เอาหัวข้อแยกกลุ่ม ส่วนตัว / จัดการทีม ออกจาก Bottom Bar เพื่อลด
            ความสูงและความแออัด"*. The grouping is not gone, it moved: it is what
            the drawer under the app bar's avatar is made of, where there is room
            for headings. See `NavDrawer`. */}
        <nav className="mobile-nav no-print" ref={navRef}>
          {barSlots.map((s) => (
            <BarSlot key={s.key} slot={s} tab={tab} onGo={goTab} />
          ))}
        </nav>

        {showFab && (
          <button
            className="fab no-print"
            onClick={() => setFormSignal((n) => n + 1)}
            title="บันทึก OT ใหม่"
          >
            +
          </button>
        )}
      </div>
    </div>
    </BackProvider>
  );
}

/** An employee printing their own F-HR-027 for a month they choose. */
function MyForm() {
  const [period, setPeriod] = useState(currentPeriod());
  return (
    <div className="stack">
      <div className="card no-print">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <h2>ใบขออนุมัติทำงานล่วงเวลา · {periodLabel(period)}</h2>
            <div className="hint" style={{ margin: 0 }}>
              รวมรายการที่อนุมัติแล้วและที่ยังรออนุมัติ · ลงนามแล้วส่งฝ่ายบุคคล
            </div>
          </div>
          <div className="field" style={{ maxWidth: 190, flex: 'none' }}>
            <label>ประจำเดือน · PERIOD</label>
            <PickMonth label="ประจำเดือน" value={period} onChange={setPeriod} />
          </div>
        </div>
      </div>
      <PrintForm period={period} />
    </div>
  );
}

function defaultTab(role) {
  if (isSigner(role)) return 'approve';
  if (role === 'hr') return 'confirm';
  if (role === 'admin') return 'admin';
  return 'mine';
}
