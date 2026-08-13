'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, currentPeriod, periodLabel } from '@/lib/api.js';
import { PASSWORD_MIN_LENGTH } from '@/lib/employees.js';
import { Alert } from './common.jsx';
import { ToastHost } from './Toast.jsx';
import { BackProvider } from './nav.jsx';
import EmployeeView from './EmployeeView.jsx';
import ApprovalQueue from './ApprovalQueue.jsx';
import QueueTabs from './QueueTabs.jsx';
import HrView from './HrView.jsx';
import AccountingView from './AccountingView.jsx';
import DepartmentView from './DepartmentView.jsx';
import AdminView from './AdminView.jsx';
import ProfileView, { ChangePassword } from './ProfileView.jsx';
import PrintForm from './PrintForm.jsx';

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
      <Shell session={session} onLogout={() => setSession(null)} />
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
          <div className="mark">Pm</div>
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
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
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
   * The badge counts the SCREEN, not one of its tabs.
   *
   * รออนุมัติ and รอ HR ยืนยัน each now hold two piles of work — requests waiting
   * for a signature, and birthdays waiting for somebody to check the scan record
   * — and a badge that counted only the first would go to zero with a tab still
   * full. Inside the screen the two numbers stay apart, on their own tabs,
   * because they are two different jobs; out here they are one answer to "is
   * there anything for me".
   *
   * `birthdayPending` is scoped to the caller by the server, so a หัวหน้า's
   * number is their team's and ฝ่ายบุคคล's is everybody's.
   */
  const birthdayBadge = counts.birthdayPending || 0;

  const tabs = [];
  if (user.maySubmitOt) tabs.push({ key: 'mine', label: 'OT ของฉัน', icon: '◧' });
  if (user.role === 'manager') {
    tabs.push({
      key: 'approve', label: 'รออนุมัติ', icon: '◔', badge: counts.pendingMgr + birthdayBadge,
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
      icon: '◕',
      badge: counts.pendingMgrDelegated,
    });
  }
  if (['hr', 'admin'].includes(user.role)) {
    tabs.push({
      key: 'confirm', label: 'รอ HR ยืนยัน', icon: '◑', badge: counts.pendingHr + birthdayBadge,
    });
    tabs.push({ key: 'monthly', label: 'ตรวจสอบรายเดือน', icon: '▤' });
    // Closing the month, not checking it — hence its own tab next to the
    // review rather than a mode inside it.
    tabs.push({ key: 'accounting', label: 'สรุป OT ส่งบัญชี', icon: '▥' });
    // The other question the same month answers — how many hours each แผนก
    // worked, both payrolls counted together. Its own tab rather than a mode
    // inside สรุป OT ส่งบัญชี, because it is a different sheet for different
    // readers, not a different view of the submission.
    tabs.push({ key: 'departments', label: 'สรุป OT แยกแผนก', icon: '▧' });
  }
  if (user.role === 'manager') tabs.push({ key: 'monthly', label: 'สรุปทีม', icon: '▤' });
  if (user.maySubmitOt) tabs.push({ key: 'form', label: 'ใบ F-HR-027', icon: '▦' });
  // One label for both now that ฝ่ายบุคคล maintains ทะเบียนพนักงาน here as
  // well — "นโยบายและวันหยุด" named the two sections HR could use back when the
  // roster was Admin's alone, and a tab that undersells what is behind it is
  // how HR ends up asking IT to add a new hire.
  if (['hr', 'admin'].includes(user.role)) tabs.push({ key: 'admin', label: 'ตั้งค่าระบบ', icon: '⚙' });

  async function logout() {
    await api.post('/auth/logout');
    onLogout();
  }

  const [title, meta] = PAGE[tab] || ['', ''];
  const initials = (user.code || '').replace(/[^A-Za-z0-9]/g, '').slice(-2).toUpperCase();

  return (
    <BackProvider register={register}>
    <div className="shell">
      <aside className="sidebar no-print">
        <div className="brand">
          <div className="mark">Pm</div>
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
              onClick={() => goTab(t.key)}
            >
              <span className="icon">{t.icon}</span>
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
            <span className="mark-sm" aria-hidden="true">Pm</span>
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
            {tab === 'mine' && <EmployeeView user={user} onChanged={refreshCounts} openSignal={formSignal} />}
            {tab === 'approve' && (
              <QueueTabs
                user={user}
                stage="pending_mgr"
                pendingCount={counts.pendingMgr}
                initialTab={queueTab}
                onCounts={(n) => setCounts((c) => ({ ...c, birthdayPending: n }))}
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
                initialTab={queueTab}
                onCounts={(n) => setCounts((c) => ({ ...c, birthdayPending: n }))}
                onChanged={queueDone}
                onOpenPolicy={openPolicy}
                onOpenRoster={mayOpenRoster ? openRoster : null}
              />
            )}
            {tab === 'monthly' && (
              <HrView
                user={user}
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
            {tab === 'profile' && <ProfileView user={user} onLogout={logout} />}
          </div>
        </main>

        <div className="mobile-nav-spacer no-print" />

        <nav className="mobile-nav no-print">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'active' : ''}
              onClick={() => goTab(t.key)}
            >
              <span className="icon">
                {t.icon}
                {t.badge > 0 && <span className="count" key={t.badge}>{t.badge}</span>}
              </span>
              <span className="label">{t.label}</span>
            </button>
          ))}
        </nav>

        {user.maySubmitOt && tab === 'mine' && (
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
