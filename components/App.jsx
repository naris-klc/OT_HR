'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, currentPeriod, periodLabel } from '@/lib/api.js';
import { PASSWORD_MIN_LENGTH } from '@/lib/employees.js';
import { Alert, PasswordInput, TipButton } from './common.jsx';
import Icon from './icons.jsx';
import { PickMonth } from './PickDate.jsx';
import { ToastHost } from './Toast.jsx';
import { BackProvider } from './nav.jsx';
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
import ProfileView, { ChangePassword } from './ProfileView.jsx';
import PrintForm from './PrintForm.jsx';

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

  async function signOut() {
    await api.post('/auth/logout').catch(() => {});
    setSession(null);
  }

  if (loading) return <div className="empty">กำลังโหลด…</div>;
  if (!session) return <Login onLogin={setSession} />;
  // An account whose password ฝ่ายบุคคล set gets exactly one screen until the
  // person holding it has replaced that password. Placed here rather than
  // inside the shell on purpose: there is no tab to wander off to, no queue
  // loading behind it, and no version of this that can be dismissed.
  if (session.user.mustChangePassword) {
    return (
      <FirstLogin
        user={session.user}
        onDone={async () => setSession(await api.get('/auth/me'))}
        onLogout={signOut}
      />
    );
  }
  return (
    <ToastHost>
      {/* Outside Shell, so every screen and every form opened over one reads
          the same copy — see components/policyContext.jsx for why this is not
          a prop. `session.policy` is what /auth/me sent. */}
      <PolicyProvider policy={session.policy}>
        <Shell session={session} onLogout={() => setSession(null)} />
      </PolicyProvider>
    </ToastHost>
  );
}

// ── first login ─────────────────────────────────────────────────────────────

/**
 * ตั้งรหัสผ่านของคุณเอง — the gate between an HR-issued password and the rest
 * of the system.
 *
 * The initial password is the employee's own รหัสพนักงาน, which is printed on
 * every form in the building, so anybody who has seen a roster can log in as
 * anybody who never changed it. The gate is what makes "แล้วค่อยให้พนักงาน
 * เปลี่ยนรหัสผ่านทีหลัง" a step that actually happens rather than one everyone
 * means to get around to.
 *
 * That sentence was written for the scheme this system had before 2026-08, was
 * left standing while the default was a random `generateTempPassword()` value,
 * and became true again on 2026-09-02 when HR asked for the employee code back
 * (see lib/employees.js). It is the whole justification for this gate existing:
 * remove the gate and the roster becomes a list of working logins.
 *
 * ออกจากระบบ is the only other way out, and it leaves the flag set — coming
 * back lands here again.
 */
function FirstLogin({ user, onDone, onLogout }) {
  return (
    <div className="page">
      <div className="stack">
        <div className="card">
          <h2>ตั้งรหัสผ่านของคุณ</h2>
          <div className="hint" style={{ marginBottom: 0 }}>
            สวัสดี {user.name} · รหัสผ่านที่ใช้อยู่ตอนนี้เป็นรหัสที่ฝ่ายบุคคลตั้งให้
            {' '}จึงมีคนอื่นทราบด้วย — กรุณาตั้งรหัสผ่านของคุณเองก่อนเริ่มใช้งาน
          </div>
        </div>
        <ChangePassword
          onDone={onDone}
          hint={<>
            {/* Named outright rather than left as "รหัสที่ฝ่ายบุคคลแจ้งให้ทราบ".
                Whoever is reading this got here by typing that value a moment
                ago — but the ones who get stuck are the ones who were told
                nothing and guessed, and for them this line is the answer. */}
            “รหัสผ่านเดิม” คือ<strong>รหัสผ่านเริ่มต้นสำหรับเข้าใช้งานครั้งแรก หรือหลังการรีเซ็ต
            {' '}ซึ่งคือรหัสพนักงานของคุณ</strong> (หรือรหัสอื่นที่ฝ่ายบุคคลแจ้งให้ทราบ)
            {/* The character set named here as well as on หน้าโปรไฟล์, because
                this gate is where most people meet the form for the only time —
                and it is the screen where somebody is most likely to reach for
                a Thai word. */}
            {' '}· รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย {PASSWORD_MIN_LENGTH} ตัวอักษร
            {' '}(ใช้ตัวอักษรไทย ตัวอักษรอังกฤษ ตัวเลข หรืออักขระพิเศษได้) และต้องไม่ซ้ำกับรหัสเดิม
          </>}
        />
        <div className="card">
          <button className="btn ghost" onClick={onLogout}>ออกจากระบบ</button>
        </div>
      </div>
    </div>
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
            บันทึก OT วันธรรมดาหลัง 17:00 น. และวันหยุดเสาร์–อาทิตย์
            ส่งให้หัวหน้างานอนุมัติ แล้วส่งต่อ HR เพื่อประมวลผลเงินเดือน
          </p>
        </div>
        <div className="ver">F-HR-027 Rev.4 · Primus Instrument Co., Ltd.</div>
      </div>

      <div className="login-form">
        <div className="inner">
          <h2>เข้าสู่ระบบ</h2>
          <p className="lede">ใช้รหัสพนักงานและรหัสผ่านของบริษัท</p>
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
                placeholder="PM-0412"
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
              {blanks.password && (
                <div className="field-note error" id="login-password-blank">กรุณากรอกรหัสผ่าน</div>
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
          {/* The line that answers "I have never logged in" without anybody
              having to ask. It goes under the form rather than beside the
              password box: somebody who knows their password reads neither, and
              somebody who does not is looking at the bottom of the card for a
              way out — which used to be ติดต่อฝ่ายบุคคล and one phone call. */}
          <div className="foot">
            รหัสผ่านเริ่มต้นสำหรับเข้าใช้งานครั้งแรก หรือหลังการรีเซ็ต คือ <strong>รหัสพนักงานของคุณ</strong>
            {' '}— ระบบจะให้ตั้งรหัสผ่านของตัวเองทันทีที่เข้าครั้งแรก
            <br />
            ระบบใช้งานได้ทั้งบนมือถือและคอมพิวเตอร์ · หากลืมรหัสผ่าน ติดต่อฝ่ายบุคคล
          </div>
        </div>
      </div>
    </div>
  );
}

// ── shell ───────────────────────────────────────────────────────────────────

const ROLE_LABEL = {
  employee: 'พนักงาน', manager: 'หัวหน้างาน', hr: 'ฝ่ายบุคคล', admin: 'ผู้ดูแลระบบ',
};

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
  monthly: ['ตรวจสอบประจำเดือน', 'MONTHLY REVIEW'],
  accounting: ['รายงาน OT ฝ่ายบัญชี', 'PAYROLL SUBMISSION'],
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
};

/**
 * THE ONE HEADING THAT DEPENDS ON WHO IS READING IT.
 *
 * `monthly` is a single screen key that two roles reach — ฝ่ายบุคคล open the
 * whole company, a หัวหน้า opens their own team, and the server does the
 * scoping. The MENU has always said two different things about it, and until
 * 2026-08-31 the heading did not: a หัวหน้า pressed a tab reading สรุปทีม and
 * arrived at a page titled ตรวจสอบรายเดือน, which is HR's job description and
 * not theirs. Harmless while the label was three syllables and nobody looked
 * twice; it stopped being harmless the moment the tab was renamed to something
 * a person would expect the page to repeat back to them.
 *
 * KEYED BY ROLE AND THEN BY TAB, so a lookup that finds nothing falls through
 * to `PAGE` and this table stays the exception rather than a second copy of it.
 * Everything the comment above says about `PAGE` still holds — this is a
 * constant, drawn before any screen has loaded, and its titles do not depend
 * on a single row of data.
 */
const PAGE_BY_ROLE = {
  manager: { monthly: ['รายงาน OT ประจำทีม', 'TEAM SUMMARY'] },
};

function Shell({ session, onLogout }) {
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
   *
   * WHAT EACH ROLE ACTUALLY GETS, counted off `lib/session.js` where
   * `maySubmitOt` is `role === 'employee'` and nothing else:
   *
   *   พนักงาน        2 — OT ของฉัน · ใบ F-HR-027
   *   หัวหน้างาน      2 — รายการรออนุมัติ · รายงาน OT ประจำทีม
   *   ฝ่ายบุคคล       5 — รออนุมัติ OT · ตรวจสอบประจำเดือน · รายงาน OT ฝ่ายบัญชี
   *                      · รายงาน OT แยกแผนก · ตั้งค่าระบบ
   *   ผู้ดูแลระบบ      6 — those five and บันทึกประวัติระบบ
   *
   * PLUS TWO THAT COME AND GO, both ฝ่ายบุคคล/ผู้ดูแลระบบ only and both
   * conditional on the state of the data rather than on a role: รออนุมัติแทน
   * while any team is covered, and ไม่มีหัวหน้าเซ็น while any request is stuck.
   * So "ฝ่ายบุคคล has five" is the steady state and not a maximum — a covered
   * team makes it six, and an admin with both faults open sees eight.
   *
   * NOBODY BUT AN EMPLOYEE HAS OT ของฉัน OR ใบ F-HR-027, and that is not a
   * nav decision — §2 says หัวหน้างาน do not do OT, `Employee.maySubmitOt()`
   * says so, and `lib/session.js` hands this component the answer. Writing
   * `role === 'employee'` here would be that rule living in two files.
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
    tabs.push({ key: 'mine', label: 'บันทึกและประวัติ OT', icon: 'clock' });
    tabs.push({ key: 'form', label: 'พิมพ์ใบขออนุมัติ OT', icon: 'document' });
  }

  // ── หัวหน้างาน · TWO TABS, AND THEY ARE THE WHOLE SCREEN ──────────────────
  /**
   * A หัวหน้า files no OT, so neither OT ของฉัน nor ใบ F-HR-027 is drawn for
   * them and these two are the entire bar — the one nav in this app where the
   * phone bar is not a compressed version of a longer list.
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
  if (user.role === 'manager') {
    tabs.push({
      key: 'approve', label: 'รายการรออนุมัติ', icon: 'inbox', badge: queueBadge(counts.pendingMgr),
    });
    // `monthly` is the same screen key ฝ่ายบุคคล open, scoped to this
    // person's team by the server. The HEADING differs, because "ตรวจสอบ
    // ประจำเดือน" is not what a หัวหน้า came here to do — see `PAGE_BY_ROLE`.
    tabs.push({ key: 'monthly', label: 'รายงาน OT ประจำทีม', icon: 'chart' });
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
      badge: counts.unsignedPending,
    });
  }
  if (['hr', 'admin'].includes(user.role)) {
    tabs.push({
      key: 'confirm',
      label: 'รออนุมัติ OT',
      icon: 'check',
      // The overlap is theirs alone: an open withdrawal request on a
      // `pending_hr` entry is already inside `pendingHr`. See `queueBadge`.
      badge: queueBadge(counts.pendingHr, counts.withdrawalOpenPendingHr),
    });
    tabs.push({ key: 'monthly', label: 'ตรวจสอบประจำเดือน', icon: 'calendar' });
    // Closing the month, not checking it — hence its own tab next to the
    // review rather than a mode inside it.
    tabs.push({ key: 'accounting', label: 'รายงาน OT ฝ่ายบัญชี', icon: 'banknote' });
    // The other question the same month answers — how many hours each แผนก
    // worked, both payrolls counted together. Its own tab rather than a mode
    // inside สรุป OT ส่งบัญชี, because it is a different sheet for different
    // readers, not a different view of the submission.
    tabs.push({ key: 'departments', label: 'รายงาน OT แยกแผนก', icon: 'org' });
    // One label for both now that ฝ่ายบุคคล maintains ทะเบียนพนักงาน here as
    // well — "นโยบายและวันหยุด" named the two sections HR could use back when
    // the roster was Admin's alone, and a tab that undersells what is behind it
    // is how HR ends up asking IT to add a new hire.
    tabs.push({ key: 'admin', label: 'ตั้งค่าระบบ', icon: 'sliders' });
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
  if (user.role === 'admin') tabs.push({ key: 'logs', label: 'บันทึกประวัติระบบ', icon: 'shield' });

  async function logout() {
    await api.post('/auth/logout');
    onLogout();
  }

  // Read twice — by the FAB itself and by the spacer that has to keep the last
  // row out from under it.
  const showFab = user.maySubmitOt && tab === 'mine';

  const [title, meta, note] = PAGE_BY_ROLE[user.role]?.[tab] || PAGE[tab] || ['', '', null];
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
    <div className="shell">
      <aside className="sidebar no-print">
        <div className="brand">
          <BrandMark className="mark" />
          <div>
            <div className="name">PRIMUS</div>
            <div className="kicker">OT SYSTEM</div>
          </div>
        </div>

        <nav className="nav">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'active' : ''}
              /* `aria-current` says what the colour says.

                 The open tab is marked by a fill here and by green type on
                 the phone bar, and neither of those reaches somebody who is
                 not looking at the screen — so the one button that is the
                 page they are on was, to a screen reader, the fourth button
                 in a row of eight. Read off the same `tab === t.key` as the
                 class, so the two can never come apart. */
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => goTab(t.key)}
            >
              <span className="icon"><Icon name={t.icon} /></span>
              <span className="label">{t.label}</span>
              {/* Keyed on the number: React remounts the span when the count
                  moves, which replays the CSS pop. The queue emptying is the
                  one change worth noticing out of the corner of an eye, and
                  at 0 the badge leaves instead. */}
              {t.badge > 0 && <span className="count" key={t.badge}>{t.badge}</span>}
            </button>
          ))}
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
              <div className="r">{ROLE_LABEL[user.role]} · {user.department?.name || '—'}</div>
            </div>
            <span className="chev">›</span>
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
          {/* On mobile the sidebar is gone, so this is the way to ข้อมูลส่วนตัว —
              and to ออกจากระบบ, which now lives on that page rather than one
              mistap away here. */}
          <button className="avatar" onClick={() => goTab('profile')} title="ข้อมูลส่วนตัว">{initials}</button>
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
            {tab === 'monthly' && (
              <HrView
                user={user}
                onOpenRoster={mayOpenRoster ? openRoster : null}
              />
            )}
            {tab === 'accounting' && <AccountingView />}
            {tab === 'departments' && <DepartmentView />}
            {tab === 'form' && <MyForm />}
            {tab === 'admin' && <AdminView user={user} initialSection={adminSection} />}
            {tab === 'logs' && <LogSystem />}
            {tab === 'profile' && <ProfileView user={user} onLogout={logout} />}
          </div>
        </main>

        {/* The spacer clears whatever is pinned to the bottom of THIS screen.
            That is the nav bar everywhere, and on หน้า OT ของฉัน the FAB as
            well — which floats 92px up and is 58 tall, so a spacer sized for
            the nav alone left the last row's status chip underneath it.

            How tall it is for the BAR is no longer written down anywhere: the
            bar measures itself into `--nav-h` — see the observer above. */}
        <div className={`mobile-nav-spacer no-print${showFab ? ' with-fab' : ''}`} />

        <nav className="mobile-nav no-print" ref={navRef}>
          {tabs.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'active' : ''}
              /* The same pair as the sidebar, off the same state — see the
                 note there. */
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => goTab(t.key)}
            >
              <span className="icon">
                <Icon name={t.icon} />
                {t.badge > 0 && <span className="count" key={t.badge}>{t.badge}</span>}
              </span>
              <span className="label">{t.label}</span>
            </button>
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
  if (role === 'manager') return 'approve';
  if (role === 'hr') return 'confirm';
  if (role === 'admin') return 'admin';
  return 'mine';
}
