
import React, { useEffect, useState } from 'react';
import { api, currentPeriod, periodLabel } from './api.js';
import { Alert } from './components/common.jsx';
import EmployeeView from './components/EmployeeView.jsx';
import ApprovalQueue from './components/ApprovalQueue.jsx';
import HrView from './components/HrView.jsx';
import AdminView from './components/AdminView.jsx';
import PrintForm from './components/PrintForm.jsx';

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
    <div className="login">
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green-dark)' }}>
          ระบบขออนุมัติทำงานล่วงเวลา
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          บริษัท ไพรมัส อินสตรูเมนท์ จำกัด · F-HR-027 Rev.4
        </div>
      </div>
      <form className="card" onSubmit={submit}>
        <div className="field">
          <label>รหัสพนักงาน</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus required placeholder="PM-0412" />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>รหัสผ่าน</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        <button className="btn" style={{ width: '100%', marginTop: 16 }} disabled={busy}>
          เข้าสู่ระบบ
        </button>
      </form>
    </div>
  );
}

// ── shell ───────────────────────────────────────────────────────────────────

const ROLE_LABEL = {
  employee: 'พนักงาน', manager: 'หัวหน้างาน', hr: 'ฝ่ายบุคคล', admin: 'ผู้ดูแลระบบ',
};

function Shell({ session, onLogout }) {
  const { user } = session;
  const [tab, setTab] = useState(() => defaultTab(user.role));
  const [counts, setCounts] = useState({ pendingMgr: 0, pendingHr: 0 });

  async function refreshCounts() {
    try { setCounts(await api.get('/entries/queue-summary')); } catch { /* not fatal */ }
  }
  useEffect(() => { refreshCounts(); }, [tab]);

  const tabs = [];
  if (user.maySubmitOt) tabs.push({ key: 'mine', label: 'OT ของฉัน' });
  if (user.role === 'manager') tabs.push({ key: 'approve', label: 'รออนุมัติ', badge: counts.pendingMgr });
  if (['hr', 'admin'].includes(user.role)) {
    tabs.push({ key: 'confirm', label: 'รอ HR ยืนยัน', badge: counts.pendingHr });
    tabs.push({ key: 'monthly', label: 'ตรวจสอบรายเดือน' });
  }
  if (user.role === 'manager') tabs.push({ key: 'monthly', label: 'สรุปทีม' });
  if (user.maySubmitOt) tabs.push({ key: 'form', label: 'ใบ F-HR-027' });
  if (user.role === 'admin') tabs.push({ key: 'admin', label: 'ตั้งค่าระบบ' });
  if (user.role === 'hr') tabs.push({ key: 'admin', label: 'นโยบายและวันหยุด' });

  async function logout() {
    await api.post('/auth/logout');
    onLogout();
  }

  return (
    <>
      <header className="topbar no-print">
        <div>
          <h1>ระบบขออนุมัติทำงานล่วงเวลา</h1>
          <div className="sub">บริษัท ไพรมัส อินสตรูเมนท์ จำกัด</div>
        </div>
        <div className="spacer" />
        <div className="who">
          <div><strong>{user.name}</strong></div>
          <div>{ROLE_LABEL[user.role]} · {user.department?.name || '—'}</div>
        </div>
        <button className="btn ghost sm" onClick={logout}>ออกจากระบบ</button>
      </header>

      <nav className="tabs no-print">
        {tabs.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
            {t.badge > 0 && <span className="badge">{t.badge}</span>}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'mine' && <EmployeeView user={user} onChanged={refreshCounts} />}
        {tab === 'approve' && <ApprovalQueue user={user} stage="pending_mgr" onChanged={refreshCounts} />}
        {tab === 'confirm' && <ApprovalQueue user={user} stage="pending_hr" onChanged={refreshCounts} />}
        {tab === 'monthly' && <HrView user={user} />}
        {tab === 'form' && <MyForm />}
        {tab === 'admin' && <AdminView user={user} />}
      </main>
    </>
  );
}

/** An employee printing their own F-HR-027 for a month they choose. */
function MyForm() {
  const [period, setPeriod] = useState(currentPeriod());
  return (
    <>
      <div className="card no-print">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <h2>ใบขออนุมัติทำงานล่วงเวลา · {periodLabel(period)}</h2>
            <div className="hint" style={{ margin: 0 }}>
              รวมรายการที่อนุมัติแล้วและที่ยังรออนุมัติ · ลงนามแล้วส่งฝ่ายบุคคล
            </div>
          </div>
          <div className="field" style={{ maxWidth: 170 }}>
            <label>ประจำเดือน</label>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
        </div>
      </div>
      <PrintForm period={period} />
    </>
  );
}

function defaultTab(role) {
  if (role === 'manager') return 'approve';
  if (role === 'hr') return 'confirm';
  if (role === 'admin') return 'admin';
  return 'mine';
}
