import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, dayName, currentPeriod, periodLabel, BUCKETS } from '../api.js';
import { StatusChip, Alert, Empty, BucketSplit } from './common.jsx';
import OtForm from './OtForm.jsx';

export default function EmployeeView({ user, onChanged }) {
  const [entries, setEntries] = useState([]);
  const [usage, setUsage] = useState(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [editing, setEditing] = useState(null); // entry being corrected
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [list, use] = await Promise.all([
        api.get('/entries?limit=200'),
        api.get(`/entries/usage/${period}`),
      ]);
      setEntries(list.entries);
      setUsage(use);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [period]);

  async function cancel(entry) {
    if (!confirm('ยกเลิกรายการนี้?')) return;
    try {
      await api.post(`/entries/${entry._id}/cancel`);
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); }
  }

  if (!user.maySubmitOt) {
    return (
      <div className="card">
        <h2>ตำแหน่งนี้ไม่บันทึก OT</h2>
        <div className="hint">
          หัวหน้างานไม่มีสิทธิ์ขอ OT ตามข้อกำหนดของระบบ — ใช้แท็บ “อนุมัติ” เพื่อตรวจรายการของทีม
        </div>
      </div>
    );
  }

  const monthEntries = entries.filter((e) => e.period === period);

  return (
    <>
      {error && <Alert kind="error">{error}</Alert>}

      {(showForm || editing) ? (
        <OtForm
          entry={editing}
          onSaved={() => { setShowForm(false); setEditing(null); load(); onChanged?.(); }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      ) : (
        <div className="card">
          <div className="row" style={{ alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <h2>OT ของฉัน</h2>
              <div className="hint" style={{ margin: 0 }}>
                {user.name} · {user.department?.name} · {user.code}
              </div>
            </div>
            <button className="btn" onClick={() => setShowForm(true)}>+ บันทึก OT</button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <h2>สรุป {periodLabel(period)}</h2>
          </div>
          <div className="field" style={{ maxWidth: 170, flex: '0 0 auto' }}>
            <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </div>
        </div>

        {usage && (
          <>
            <BucketSplit buckets={usage.summary.buckets} total={usage.summary.otHours} label="รวมชั่วโมง" />
            {usage.capHours != null ? (
              <Alert kind={usage.usedHours > usage.capHours ? 'warn' : 'ok'}>
                เพดานแผนก {usage.capHours} ชม./เดือน · ใช้ไปแล้ว {hours(usage.usedHours)} ชม.
                {usage.basis === 'weighted' && ' (นับแบบคูณอัตรา)'}
              </Alert>
            ) : (
              <div className="hint" style={{ marginTop: 10 }}>แผนกนี้ไม่กำหนดเพดานชั่วโมงต่อเดือน</div>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>ประวัติการขอ OT</h2>
        <div className="hint">รายการที่ไม่อนุมัติสามารถแก้ไขและส่งใหม่ได้</div>
        {monthEntries.length === 0 ? (
          <Empty>ยังไม่มีรายการในเดือนนี้</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>วันที่</th>
                  <th>เวลา</th>
                  <th className="num">×1.5 ปกติ</th>
                  <th className="num">×1.5 วันหยุด</th>
                  <th className="num">×3</th>
                  <th className="num">รวม</th>
                  <th>รายละเอียด</th>
                  <th>สถานะ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {monthEntries.map((e) => (
                  <tr key={e._id}>
                    <td>
                      {thaiDate(e.workDate)}
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>วัน{dayName(e.workDate)}</div>
                    </td>
                    <td>
                      {e.startTime}–{e.endTime}
                      {e.endsNextDay && <div style={{ fontSize: 12, color: 'var(--amber)' }}>ข้ามคืน</div>}
                      {e.noBreakTaken && <div style={{ fontSize: 12, color: 'var(--muted)' }}>ไม่พักเที่ยง</div>}
                    </td>
                    <td className="num">{hours(e.buckets?.[BUCKETS.OT15_WEEKDAY])}</td>
                    <td className="num">{hours(e.buckets?.[BUCKETS.OT15_HOLIDAY])}</td>
                    <td className="num">{hours(e.buckets?.[BUCKETS.OT3_HOLIDAY])}</td>
                    <td className="num"><strong>{hours(e.totals?.otHours)}</strong></td>
                    <td style={{ maxWidth: 260 }}>
                      {e.description}
                      {e.rejectionReason && (
                        <div style={{ fontSize: 12, color: 'var(--red)' }}>เหตุผล: {e.rejectionReason}</div>
                      )}
                    </td>
                    <td><StatusChip status={e.status} /></td>
                    <td>
                      {e.status === 'pending_mgr' && (
                        <button className="btn ghost sm" onClick={() => cancel(e)}>ยกเลิก</button>
                      )}
                      {(e.status === 'rejected' || e.status === 'pending_mgr') && (
                        <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => setEditing(e)}>
                          แก้ไข
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
