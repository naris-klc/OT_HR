'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, currentPeriod, periodLabel } from '@/lib/api.js';
import { PASSWORD_MIN_LENGTH } from '@/lib/employees.js';
import { Alert, PasswordInput } from './common.jsx';
import Icon from './icons.jsx';
import { ToastHost } from './Toast.jsx';
import { BackProvider } from './nav.jsx';
import { PolicyProvider } from './policyContext.jsx';
import EmployeeView from './EmployeeView.jsx';
import ApprovalQueue from './ApprovalQueue.jsx';
import { BackupBanner } from './BackupBanner.jsx';
import QueueTabs from './QueueTabs.jsx';
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
 * The initial password is derived from the employee code, which is printed on
 * every form in the building, so anybody who has seen a roster can log in as
 * anybody who never changed it. The gate is what makes "แล้วค่อยให้พนักงาน
 * เปลี่ยนรหัสผ่านทีหลัง" a step that actually happens rather than one everyone
 * means to get around to.
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
            “รหัสผ่านเดิม” คือรหัสที่ฝ่ายบุคคลแจ้งให้ทราบ
            {' '}· รหัสผ่านใหม่ต้องยาวอย่างน้อย {PASSWORD_MIN_LENGTH} ตัวอักษร และต้องไม่ซ้ำกับรหัสเดิม
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

  async function submit(e) {
    e.preventDefault();
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
          <form onSubmit={submit}>
            <div className="field">
              <label>รหัสพนักงาน · EMPLOYEE ID</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
                required
                placeholder="PM-0412"
              />
            </div>
            <div className="field" style={{ marginTop: 16 }}>
              <label>รหัสผ่าน · PASSWORD</label>
              {/* This was written out here, and เปลี่ยนรหัสผ่าน then needed the
                  same control three more times. It is `PasswordInput` in
                  components/common.jsx now, which is also where the reasons it
                  is built the way it is are written down — the `type="button"`
                  that keeps the eye from submitting this form against the login
                  throttle, above all. Nothing about what draws here changed. */}
              <PasswordInput
                shown={passwordShown}
                onToggle={() => setPasswordShown((shown) => !shown)}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
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
          <div className="foot">
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

/** Page heading and the mono kicker under it, per tab. */
const PAGE = {
  mine: ['OT ของฉัน', 'MY OVERTIME'],
  approve: ['รออนุมัติ', 'PENDING · MANAGER'],
  delegated: ['รออนุมัติแทน', 'PENDING · DELEGATED'],
  confirm: ['รอ HR ยืนยัน', 'PENDING · HR'],
  monthly: ['ตรวจสอบรายเดือน', 'MONTHLY REVIEW'],
  accounting: ['สรุป OT ส่งบัญชี', 'PAYROLL SUBMISSION'],
  departments: ['สรุป OT แยกแผนก', 'DEPARTMENT SUMMARY'],
  form: ['ใบ F-HR-027', 'PRINTABLE FORM'],
  admin: ['ตั้งค่าระบบ', 'SETTINGS & POLICY'],
  logs: ['บันทึกระบบ', 'SYSTEM & ACCESS LOG'],
  profile: ['ข้อมูลส่วนตัว', 'MY PROFILE'],
};

function Shell({ session, onLogout }) {
  const { user } = session;
  const home = defaultTab(user.role);
  const [tab, setTab] = useState(home);
  const [counts, setCounts] = useState({
    pendingMgr: 0, pendingHr: 0, pendingMgrDelegated: 0, delegatedTeams: 0, birthdayPending: 0,
  });
  /**
   * Which sub-tab the queue screen should open on, when something sent us there.
   *
   * Same shape as `adminSection` below and cleared the same way — a signal for
   * one arrival, not a stored preference. The status line at the foot of
   * ตรวจสอบรายเดือน is the only thing that sets it.
   */
  const [queueTab, setQueueTab] = useState(null);
  /**
   * Which of the queue screen's two tabs is open — reported by QueueTabs, and
   * meaningful only while one of those screens is the current tab. `null` says
   * "nobody is looking at that screen", which is a third state and not a
   * default: it is what makes the badge fall back to counting both piles.
   */
  const [queueActive, setQueueActive] = useState(null);
  /**
   * Which section ตั้งค่าระบบ should open on, when something sent us there.
   * Cleared on leaving the tab (below), so it steers the one arrival it was set
   * for and the next plain click on the nav lands where it always does.
   */
  const [adminSection, setAdminSection] = useState(null);
  // Bumped by the mobile FAB; EmployeeView opens its form when it changes.
  const [formSignal, setFormSignal] = useState(0);

  async function refreshCounts() {
    try { setCounts(await api.get('/entries/queue-summary')); } catch { /* not fatal */ }
  }
  useEffect(() => { refreshCounts(); }, [tab]);
  useEffect(() => { if (tab !== 'admin') setAdminSection(null); }, [tab]);
  useEffect(() => { if (!['approve', 'confirm'].includes(tab)) setQueueTab(null); }, [tab]);
  // Leaving the screen takes the answer with it — see `queueBadge`.
  useEffect(() => { if (!['approve', 'confirm'].includes(tab)) setQueueActive(null); }, [tab]);

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
   * `birthdayPending` is scoped to the caller by the server, so a หัวหน้า's
   * number is their team's and ฝ่ายบุคคล's is everybody's.
   */
  const birthdayBadge = counts.birthdayPending || 0;

  /**
   * THE BADGE FOLLOWS THE OPEN TAB — BUT ONLY WHILE THE SCREEN IS OPEN.
   *
   * รออนุมัติ and รอ HR ยืนยัน each hold two piles of work: requests waiting for
   * a signature, and birthdays waiting for somebody to check the scan record.
   * The badge was their SUM everywhere, and the number that produced was
   * correct and unreadable — 5 on รอ HR ยืนยัน is three ใบ and two birthdays,
   * and nothing about a bare 5 said so. Asked to make it follow the tab.
   *
   * THE FALLBACK IS NOT A DETAIL, it is the whole reason this is safe. From any
   * other screen the badge is still the sum, because there is no open tab for it
   * to follow and because that is the question a nav badge answers: is there
   * anything for me over there. A badge that reported one pile while standing
   * somewhere else would hide the other one completely — the failure the old
   * comment here was written to prevent, and it still applies off-screen.
   *
   * On the screen it does not apply: both tabs are in view with their own
   * chips, so the pile the badge is not counting is being counted two
   * centimetres above it.
   *
   * BOTH BARS, and deliberately. `.sidebar` and `.mobile-nav` render the same
   * `tabs` array and never appear together — 860px hides one or the other — so
   * two rules would agree on every device and disagree the moment a window is
   * dragged across that width.
   */
  function queueBadge(key, ownPending) {
    if (tab !== key) return ownPending + birthdayBadge;
    /*
      `|| 'entries'` AND NOT A FALL BACK TO THE SUM.

      QueueTabs reports its tab from an effect, which lands after the first
      paint — so for one frame after arriving there was no answer here, and the
      badge showed the SUM on the tab being stood on. Lit green and reading 5
      while the two chips above it read 3 and 2 is the screen disagreeing with
      itself, briefly and visibly.

      'entries' rather than a guess at QueueTabs' own opening rule: it is what
      that screen opens on unless ตรวจสอบรายเดือน steered it, and being wrong
      for one frame between 3 and 2 is not something an eye can catch. Being
      wrong between 3 and 5 was.
    */
    return (queueActive || 'entries') === 'birthday' ? birthdayBadge : ownPending;
  }

  const tabs = [];
  if (user.maySubmitOt) tabs.push({ key: 'mine', label: 'OT ของฉัน', icon: 'clock' });
  if (user.role === 'manager') {
    tabs.push({
      key: 'approve', label: 'รออนุมัติ', icon: 'inbox', badge: queueBadge('approve', counts.pendingMgr),
    });
  }
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
  if (['hr', 'admin'].includes(user.role)) {
    tabs.push({
      key: 'confirm', label: 'รอ HR ยืนยัน', icon: 'check', badge: queueBadge('confirm', counts.pendingHr),
    });
    tabs.push({ key: 'monthly', label: 'ตรวจสอบรายเดือน', icon: 'calendar' });
    // Closing the month, not checking it — hence its own tab next to the
    // review rather than a mode inside it.
    tabs.push({ key: 'accounting', label: 'สรุป OT ส่งบัญชี', icon: 'banknote' });
    // The other question the same month answers — how many hours each แผนก
    // worked, both payrolls counted together. Its own tab rather than a mode
    // inside สรุป OT ส่งบัญชี, because it is a different sheet for different
    // readers, not a different view of the submission.
    tabs.push({ key: 'departments', label: 'สรุป OT แยกแผนก', icon: 'org' });
  }
  if (user.role === 'manager') tabs.push({ key: 'monthly', label: 'สรุปทีม', icon: 'chart' });
  if (user.maySubmitOt) tabs.push({ key: 'form', label: 'ใบ F-HR-027', icon: 'document' });
  // One label for both now that ฝ่ายบุคคล maintains ทะเบียนพนักงาน here as
  // well — "นโยบายและวันหยุด" named the two sections HR could use back when the
  // roster was Admin's alone, and a tab that undersells what is behind it is
  // how HR ends up asking IT to add a new hire.
  if (['hr', 'admin'].includes(user.role)) tabs.push({ key: 'admin', label: 'ตั้งค่าระบบ', icon: 'sliders' });
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
  if (user.role === 'admin') tabs.push({ key: 'logs', label: 'บันทึกระบบ', icon: 'shield' });

  async function logout() {
    await api.post('/auth/logout');
    onLogout();
  }

  // Read twice — by the FAB itself and by the spacer that has to keep the last
  // row out from under it.
  const showFab = user.maySubmitOt && tab === 'mine';

  const [title, meta] = PAGE[tab] || ['', ''];
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
            <div className="title">{title}</div>
            <div className="meta">{meta}</div>
          </div>
          {/* On mobile the sidebar is gone, so this is the way to ข้อมูลส่วนตัว —
              and to ออกจากระบบ, which now lives on that page rather than one
              mistap away here. */}
          <button className="avatar" onClick={() => goTab('profile')} title="ข้อมูลส่วนตัว">{initials}</button>
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
            {tab === 'mine' && <EmployeeView user={user} onChanged={refreshCounts} openSignal={formSignal} />}
            {tab === 'approve' && (
              <QueueTabs
                user={user}
                stage="pending_mgr"
                pendingCount={counts.pendingMgr}
                // The nav badge is the sum of this screen's two tabs, so the
                // birthday half of it is already known here — and the tab that
                // has not been opened yet has no other way to know it.
                birthdayCount={counts.birthdayPending}
                initialTab={queueTab}
                onCounts={(n) => setCounts((c) => ({ ...c, birthdayPending: n }))}
                onSettled={refreshCounts}
                onActiveTab={setQueueActive}
                onChanged={queueDone}
                onOpenPolicy={openPolicy}
                onOpenRoster={mayOpenRoster ? openRoster : null}
              />
            )}
            {/* The covered queue stays a single list: a ฝ่ายบุคคล standing in for
                a หัวหน้า already sees every birthday in the company on their own
                รอ HR ยืนยัน, so a second copy here would be the same rows twice. */}
            {tab === 'delegated' && <ApprovalQueue user={user} stage="pending_mgr" delegatedOnly onChanged={queueDone} onOpenPolicy={openPolicy} />}
            {tab === 'confirm' && (
              <QueueTabs
                user={user}
                stage="pending_hr"
                pendingCount={counts.pendingHr}
                birthdayCount={counts.birthdayPending}
                initialTab={queueTab}
                onCounts={(n) => setCounts((c) => ({ ...c, birthdayPending: n }))}
                onSettled={refreshCounts}
                onActiveTab={setQueueActive}
                onChanged={queueDone}
                onOpenPolicy={openPolicy}
                onOpenRoster={mayOpenRoster ? openRoster : null}
              />
            )}
            {tab === 'monthly' && (
              <HrView
                user={user}
                onSettled={refreshCounts}
                onOpenRoster={mayOpenRoster ? openRoster : null}
                onOpenBirthdayQueue={() => {
                  setQueueTab('birthday');
                  goTab(user.role === 'manager' ? 'approve' : 'confirm');
                }}
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
            the nav alone left the last row's status chip underneath it. */}
        <div className={`mobile-nav-spacer no-print${showFab ? ' with-fab' : ''}`} />

        <nav className="mobile-nav no-print">
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
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
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
