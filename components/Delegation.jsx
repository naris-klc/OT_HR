'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { api, thaiDate } from '@/lib/api.js';
import { Alert, Empty } from './common.jsx';
import { useToast } from './Toast.jsx';

/**
 * ผู้รับช่วงอนุมัติแทน — setting up, reading and ending a stand-in.
 *
 * One component, two placements, because the two callers are asking the same
 * question about different people. A หัวหน้า opens it on ข้อมูลส่วนตัว to
 * arrange their own cover; ฝ่ายบุคคล opens it under ตั้งค่าระบบ to arrange it
 * for a หัวหน้า who is already away — which is the case the whole feature is
 * for, and the reason `scope="all"` exists at all. Two screens would be two
 * versions of the same form, and the one used less often is the one that would
 * end up missing the rule that matters.
 */
export default function Delegation({ user, scope = 'mine' }) {
  const all = scope === 'all';
  const toast = useToast();

  const [rows, setRows] = useState(null);
  const [today, setToday] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const res = await api.get(`/delegations${all ? '?all=1' : ''}`);
      setRows(res.delegations);
      setToday(res.today);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [scope]);

  /**
   * Live first, then what has not started, then what is over.
   *
   * The order is the order the questions get asked: "who is covering my queue
   * right now" is answered by looking at the top of the list, and the expired
   * ones are kept because they are the evidence behind approvals already on
   * the record — a delegation that vanished when it lapsed would take the
   * answer to "why was B allowed to sign that" with it.
   */
  const groups = useMemo(() => {
    const order = { active: 0, scheduled: 1, expired: 2, revoked: 3 };
    return [...(rows || [])].sort((a, b) => (
      order[a.state] - order[b.state] || b.fromDate.localeCompare(a.fromDate)
    ));
  }, [rows]);

  async function revoke(row) {
    setBusy(true);
    try {
      await api.del(`/delegations/${row._id}`);
      await load();
      toast(`ยกเลิกการมอบหมายให้ ${row.to?.name} แล้ว`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const active = groups.filter((d) => d.state === 'active');

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h2>ผู้รับช่วงอนุมัติแทน</h2>
          <div className="hint" style={{ margin: 0 }}>
            {all
              ? 'ตั้งผู้รับช่วงอนุมัติแทนหัวหน้างานคนใดก็ได้ — ใช้เมื่อหัวหน้างานลากะทันหันจนตั้งเองไม่ได้'
              : 'ให้คนอื่นอนุมัติคิวของคุณแทนได้ชั่วคราว ระหว่างที่คุณไม่อยู่'}
          </div>
        </div>
        <button className="btn" onClick={() => setOpen((v) => !v)}>
          {open ? 'ปิดฟอร์ม' : '+ มอบหมายผู้รับช่วง'}
        </button>
      </div>

      {/*
        Said before the form, because it is what people get wrong about this.
        The two halves are the two questions asked after the fact — "did I
        remember to turn it off" (there is nothing to turn off) and "can I still
        approve things myself" (yes, always).
      */}
      <Alert kind="info">
        การมอบหมาย<strong>หมดอายุเองตามวันที่กำหนด</strong> ไม่มีสวิตช์เปิด/ปิดที่ต้องกลับมาปิด ·
        {' '}และเป็นการ<strong>เพิ่ม</strong>สิทธิ์ ไม่ใช่ย้าย —
        {' '}หัวหน้างานเจ้าของคิวยังอนุมัติเองได้ตลอด ถ้ากลับมาก่อนกำหนดก็ไม่ต้องทำอะไร
        <div style={{ fontSize: 12.5, marginTop: 4 }}>
          ทุกการอนุมัติของผู้รับช่วงจะถูกบันทึกว่า “<strong>ทำแทน</strong>” พร้อมชื่อหัวหน้างานเจ้าของคิว
          {' '}ทั้งในประวัติรายการและบนใบพิมพ์ · ผู้รับช่วง<strong>มอบหมายต่อเป็นทอดไม่ได้</strong>
        </div>
      </Alert>

      {error && <Alert kind="error">{error}</Alert>}

      {open && (
        <DelegationForm
          user={user}
          all={all}
          onSaved={async (row) => {
            setOpen(false);
            await load();
            toast(`มอบหมายให้ ${row.to?.name} อนุมัติแทน ${thaiDate(row.fromDate)} – ${thaiDate(row.toDate)} แล้ว`);
          }}
          onError={setError}
        />
      )}

      {!rows ? <Empty>กำลังโหลด…</Empty> : groups.length === 0 ? (
        <Empty>{all ? 'ยังไม่มีการมอบหมายในระบบ' : 'ยังไม่เคยมอบหมายผู้รับช่วง'}</Empty>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>สถานะ</th>
                <th>คิวของ</th>
                <th>ผู้รับช่วง</th>
                <th>ช่วงเวลา</th>
                <th>เหตุผล</th>
                <th>ผู้ตั้ง</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {groups.map((d) => (
                <tr key={d._id}>
                  <td><StateChip state={d.state} /></td>
                  <td>
                    {d.from?.name || '—'}
                    <div className="cell-sub">{d.from?.code}</div>
                  </td>
                  <td>
                    {d.to?.name || '—'}
                    <div className="cell-sub">{d.to?.code} · {ROLE[d.to?.role] || d.to?.role}</div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {thaiDate(d.fromDate)} – {thaiDate(d.toDate)}
                    {d.state === 'active' && (
                      <div className="cell-sub">เหลืออีก {daysLeft(d.toDate, today)} วัน</div>
                    )}
                  </td>
                  <td style={{ maxWidth: 220 }}>{d.reason || '—'}</td>
                  <td>
                    {d.createdByName || '—'}
                    {d.revokedAt && (
                      <div className="cell-sub">ยกเลิกโดย {d.revokedByName || '—'}</div>
                    )}
                  </td>
                  <td>
                    {/* Only what is still going forward can be called off, and
                        only by the granter or ฝ่ายบุคคล — which the server
                        enforces; this just does not offer it. */}
                    {['active', 'scheduled'].includes(d.state)
                      && (all || d.from?.id === String(user.id || user._id)) && (
                      <button className="btn ghost sm" disabled={busy} onClick={() => revoke(d)}>
                        ยกเลิก
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active.length === 0 && rows?.length > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          ไม่มีการมอบหมายที่มีผลอยู่ในขณะนี้ — รายการด้านบนหมดอายุหรือถูกยกเลิกไปแล้ว
          {' '}และยังเก็บไว้เพราะเป็นหลักฐานของรายการที่อนุมัติไปภายใต้การมอบหมายนั้น
        </div>
      )}
    </div>
  );
}

// ── the form ────────────────────────────────────────────────────────────────

function DelegationForm({ user, all, onSaved, onError }) {
  const [pool, setPool] = useState({ managers: [], candidates: [] });
  const [form, setForm] = useState({ from: '', to: '', fromDate: '', toDate: '', reason: '' });
  const [busy, setBusy] = useState(false);

  /**
   * Its own endpoint, not the roster.
   *
   * A หัวหน้า is normally covered by a หัวหน้า from another department, and
   * `GET /employees` hands a manager their own team and nobody else — the
   * person they actually want would never be in the list.
   */
  useEffect(() => {
    api.get('/delegations/candidates')
      .then(setPool)
      .catch((err) => onError(err.message));
  }, []);

  const granter = all ? form.from : String(user.id || user._id);
  const managers = pool.managers;
  // Nobody stands in for themselves — taken off the list rather than left in
  // to be refused after the dates have been typed.
  const candidates = pool.candidates.filter((p) => String(p._id) !== String(granter));

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const ready = form.to && form.fromDate && form.toDate && (!all || form.from);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post('/delegations', {
        from: all ? form.from : undefined,
        to: form.to,
        fromDate: form.fromDate,
        toDate: form.toDate,
        reason: form.reason.trim() || undefined,
      });
      onSaved(res.delegation);
    } catch (err) {
      onError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
      {all && (
        <div className="field">
          <label>คิวของหัวหน้างาน *</label>
          <select value={form.from} onChange={(e) => set('from', e.target.value)} required>
            <option value="">— เลือกหัวหน้างาน —</option>
            {managers.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} · {p.department?.nameTh || p.department?.name || '—'}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field" style={{ marginTop: all ? 12 : 0 }}>
        <label>ผู้รับช่วง *</label>
        <select value={form.to} onChange={(e) => set('to', e.target.value)} required>
          <option value="">— เลือกผู้รับช่วง —</option>
          {candidates.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name} · {ROLE[p.role]} · {p.department?.nameTh || p.department?.name || '—'}
            </option>
          ))}
        </select>
        <span className="field-note">เลือกได้เฉพาะหัวหน้างานหรือฝ่ายบุคคล</span>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <div className="field" style={{ maxWidth: 200 }}>
          <label>ตั้งแต่วันที่ *</label>
          <input type="date" value={form.fromDate} onChange={(e) => set('fromDate', e.target.value)} required />
        </div>
        <div className="field" style={{ maxWidth: 200 }}>
          <label>ถึงวันที่ *</label>
          <input type="date" value={form.toDate} onChange={(e) => set('toDate', e.target.value)} required />
          <span className="field-note">นับรวมวันสุดท้าย · หมดอายุเองหลังจากนั้น</span>
        </div>
      </div>

      <div className="field" style={{ marginTop: 12 }}>
        <label>เหตุผล</label>
        <input
          value={form.reason}
          onChange={(e) => set('reason', e.target.value)}
          maxLength={200}
          placeholder="เช่น ลาป่วย · ไปราชการต่างจังหวัด"
        />
      </div>

      <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <button className="btn" disabled={busy || !ready}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกการมอบหมาย'}
        </button>
      </div>
    </form>
  );
}

// ── small parts ─────────────────────────────────────────────────────────────

const ROLE = { manager: 'หัวหน้างาน', hr: 'ฝ่ายบุคคล', admin: 'ผู้ดูแลระบบ', employee: 'พนักงาน' };

/**
 * Four states, not two. "ยังไม่เริ่ม" and "หมดอายุแล้ว" both mean "not in
 * force" and call for opposite reactions — wait until Monday, or the dates
 * were typed backwards — so a single inactive badge would leave the person
 * guessing which mistake they made.
 */
const STATE = {
  active: ['มีผลอยู่', '#1F7A4D', '#E4F3EA'],
  scheduled: ['ยังไม่เริ่ม', '#8A5A00', '#FDF3DF'],
  expired: ['หมดอายุแล้ว', '#5A5A5A', '#EFEFEF'],
  revoked: ['ยกเลิกแล้ว', '#8A2B2B', '#F7E5E5'],
};

function StateChip({ state }) {
  const [label, fg, bg] = STATE[state] || [state, '#555', '#eee'];
  return <span className="chip" style={{ background: bg, color: fg }}>{label}</span>;
}

function daysLeft(toDate, today) {
  if (!toDate || !today) return '—';
  const days = Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  return Math.max(0, days) + 1; // inclusive of the last day
}
