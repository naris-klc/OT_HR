'use client';

import React, { useEffect, useState } from 'react';
import { api, currentPeriod, periodLabel } from '@/lib/api.js';
import { Alert } from './common.jsx';
import EmployeeView from './EmployeeView.jsx';
import ApprovalQueue from './ApprovalQueue.jsx';
import HrView from './HrView.jsx';
import AccountingView from './AccountingView.jsx';
import DepartmentView from './DepartmentView.jsx';
import AdminView from './AdminView.jsx';
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

  if (loading) return <div className="empty">กำลังโหลด…</div>;
  if (!session) return <Login onLogin={setSession} />;
  return <Shell session={session} onLogout={() => setSession(null)} />;
}

// ── login ───────────────────────────────────────────────────────────────────

function Login({ onLogin }) {
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post('/auth/login', { code, password });
      onLogin(await api.get('/auth/me'));
    } catch (err) {
      setError(err.message);
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
            {error && <Alert kind="error">{error}</Alert>}
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
  confirm: ['รอ HR ยืนยัน', 'PENDING · HR'],
  monthly: ['ตรวจสอบรายเดือน', 'MONTHLY REVIEW'],
  accounting: ['สรุป OT ส่งบัญชี', 'PAYROLL SUBMISSION'],
  departments: ['สรุป OT แยกแผนก', 'DEPARTMENT SUMMARY'],
  form: ['ใบ F-HR-027', 'PRINTABLE FORM'],
  admin: ['ตั้งค่าระบบ', 'SETTINGS & POLICY'],
};

function Shell({ session, onLogout }) {
  const { user } = session;
  const [tab, setTab] = useState(() => defaultTab(user.role));
  const [counts, setCounts] = useState({ pendingMgr: 0, pendingHr: 0 });
  // Bumped by the mobile FAB; EmployeeView opens its form when it changes.
  const [formSignal, setFormSignal] = useState(0);

  async function refreshCounts() {
    try { setCounts(await api.get('/entries/queue-summary')); } catch { /* not fatal */ }
  }
  useEffect(() => { refreshCounts(); }, [tab]);

  const tabs = [];
  if (user.maySubmitOt) tabs.push({ key: 'mine', label: 'OT ของฉัน', icon: '◧' });
  if (user.role === 'manager') tabs.push({ key: 'approve', label: 'รออนุมัติ', icon: '◔', badge: counts.pendingMgr });
  if (['hr', 'admin'].includes(user.role)) {
    tabs.push({ key: 'confirm', label: 'รอ HR ยืนยัน', icon: '◑', badge: counts.pendingHr });
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
  if (user.role === 'admin') tabs.push({ key: 'admin', label: 'ตั้งค่าระบบ', icon: '⚙' });
  if (user.role === 'hr') tabs.push({ key: 'admin', label: 'นโยบายและวันหยุด', icon: '⚙' });

  async function logout() {
    await api.post('/auth/logout');
    onLogout();
  }

  const [title, meta] = PAGE[tab] || ['', ''];
  const initials = (user.code || '').replace(/[^A-Za-z0-9]/g, '').slice(-2).toUpperCase();

  return (
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
              onClick={() => setTab(t.key)}
            >
              <span className="icon">{t.icon}</span>
              <span className="label">{t.label}</span>
              {t.badge > 0 && <span className="count">{t.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="whoami">
            <div className="avatar">{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="n">{user.name}</div>
              <div className="r">{ROLE_LABEL[user.role]} · {user.department?.name || '—'}</div>
            </div>
          </div>
          <button className="signout" onClick={logout}>ออกจากระบบ</button>
        </div>
      </aside>

      <div className="body">
        <header className="appbar no-print">
          <div className="mark-sm">Pm</div>
          <div className="grow">
            <div className="title">{title}</div>
            <div className="meta">{meta}</div>
          </div>
          <button className="avatar" onClick={logout} title="ออกจากระบบ">{initials}</button>
        </header>

        <main>
          <div className="page">
            {tab === 'mine' && <EmployeeView user={user} onChanged={refreshCounts} openSignal={formSignal} />}
            {tab === 'approve' && <ApprovalQueue user={user} stage="pending_mgr" onChanged={refreshCounts} />}
            {tab === 'confirm' && <ApprovalQueue user={user} stage="pending_hr" onChanged={refreshCounts} />}
            {tab === 'monthly' && <HrView user={user} />}
            {tab === 'accounting' && <AccountingView />}
            {tab === 'departments' && <DepartmentView />}
            {tab === 'form' && <MyForm />}
            {tab === 'admin' && <AdminView user={user} />}
          </div>
        </main>

        <div className="mobile-nav-spacer no-print" />

        <nav className="mobile-nav no-print">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'active' : ''}
              onClick={() => setTab(t.key)}
            >
              <span className="icon">
                {t.icon}
                {t.badge > 0 && <span className="count">{t.badge}</span>}
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
