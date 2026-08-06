'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, dayName, periodLabel, BUCKETS } from '@/lib/api.js';
import { Alert, Empty, StatusChip } from './common.jsx';
import OtForm from './OtForm.jsx';

/**
 * One employee's entries for one month, with HR's correction path.
 *
 * The monthly review shows totals; this is what sits behind a total when it
 * looks wrong. Rows an employee can no longer touch — already approved, or
 * sitting with the manager — are exactly the ones HR needs to be able to fix,
 * so the edit button is offered on all of them except rejected and cancelled.
 */
export default function HrEntries({ employee, period, onClose, onChanged }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  async function load() {
    try {
      setEntries(null);
      const res = await api.get(`/entries?employee=${employee._id}&period=${period}`);
      setEntries(res.entries);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [employee._id, period]);

  if (editing) {
    return (
      <OtForm
        entry={editing}
        mode="hr"
        employeeId={employee._id}
        onSaved={() => { setEditing(null); load(); onChanged?.(); }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h2>รายการ OT — {employee.name}</h2>
          <div className="hint" style={{ margin: 0 }}>
            {employee.code} · {periodLabel(period)}
          </div>
        </div>
        <button className="btn ghost" onClick={onClose}>กลับไปสรุปรายเดือน</button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {!entries ? (
        <Empty>กำลังโหลด…</Empty>
      ) : entries.length === 0 ? (
        <Empty>ไม่มีรายการในเดือนนี้</Empty>
      ) : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>จาก–ถึง</th>
                <th className="num">×1.5 ปกติ</th>
                <th className="num">×1.5 วันหยุด</th>
                <th className="num">×3</th>
                <th className="num">รวม</th>
                <th>รายละเอียดงานที่ทำ</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const lastHrEdit = [...(e.history || [])].reverse()
                  .find((h) => h.action === 'hr_edit');
                const closed = ['rejected', 'cancelled'].includes(e.status);
                return (
                  <tr key={e._id}>
                    <td>
                      {thaiDate(e.workDate)}
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>วัน{dayName(e.workDate)}</div>
                    </td>
                    <td>
                      {e.startTime}–{e.endTime}
                      {e.endsNextDay && (
                        <div style={{ fontSize: 12, color: 'var(--amber)' }}>ข้ามคืน</div>
                      )}
                    </td>
                    <td className="num">{hours(e.buckets?.[BUCKETS.OT15_WEEKDAY])}</td>
                    <td className="num">{hours(e.buckets?.[BUCKETS.OT15_HOLIDAY])}</td>
                    <td className="num">{hours(e.buckets?.[BUCKETS.OT3_HOLIDAY])}</td>
                    <td className="num"><strong>{hours(e.totals?.otHours)}</strong></td>
                    <td>
                      {e.description}
                      {lastHrEdit && (
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          แก้ไขโดย {lastHrEdit.byName || 'ฝ่ายบุคคล'}
                          {lastHrEdit.note ? ` — ${lastHrEdit.note}` : ''}
                        </div>
                      )}
                    </td>
                    <td>
                      <StatusChip status={e.status} />
                      {e.capExceeded && (
                        <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>เกินเพดาน</div>
                      )}
                    </td>
                    <td>
                      {closed ? (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>แก้ไขไม่ได้</span>
                      ) : (
                        <button className="btn ghost sm" onClick={() => setEditing(e)}>แก้ไข</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="hint" style={{ marginTop: 12 }}>
        การแก้ไขของฝ่ายบุคคลจะคำนวณชั่วโมงใหม่ทันทีและคงสถานะการอนุมัติเดิมไว้ ·
        รายการที่ไม่อนุมัติหรือยกเลิกแล้วต้องให้พนักงานส่งใหม่
      </div>
    </div>
  );
}
