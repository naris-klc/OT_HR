'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, dayName, BUCKETS } from '@/lib/api.js';
import { Alert, Empty, EditedMark, EntryHistory, Modal, SegmentList, editsOf } from './common.jsx';

/**
 * Manager review (daily) and HR confirmation (monthly) are the same table with
 * a different queue behind it (§2), so they share this component.
 */
export default function ApprovalQueue({ user, stage, onChanged }) {
  const isHr = stage === 'pending_hr';
  const [entries, setEntries] = useState([]);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(null);

  async function load() {
    try {
      const res = await api.get(`/entries?status=${stage}`);
      setEntries(res.entries);
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [stage]);

  async function approve(entry) {
    setBusy(true);
    try {
      await api.post(`/entries/${entry._id}/approve`);
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function reject() {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      await api.post(`/entries/${rejecting._id}/reject`, { reason });
      setRejecting(null);
      setReason('');
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  async function override(entry) {
    const why = prompt('เหตุผลในการอนุมัติเกินเพดาน:');
    if (!why) return;
    try {
      await api.post(`/entries/${entry._id}/cap-override`, { reason: why });
      await load();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="card">
      <h2>{isHr ? 'รอ HR ยืนยัน' : 'รอหัวหน้าอนุมัติ'}</h2>
      <div className="hint">
        {isHr
          ? 'ตรวจสอบรายเดือน · รายการที่ยืนยันแล้วจะเข้าสู่รายงานส่งออก'
          : `ตรวจสอบรายวัน · เฉพาะแผนก${user.department?.name || ''}`}
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {entries.length === 0 ? (
        <Empty>ไม่มีรายการค้างในคิวนี้</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>พนักงาน</th>
                <th>วันที่</th>
                <th>เวลา</th>
                <th className="num">×1.5 ปกติ</th>
                <th className="num">×1.5 วันหยุด</th>
                <th className="num">×3</th>
                <th className="num">รวม</th>
                <th>รายละเอียด</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <React.Fragment key={e._id}>
                  <tr>
                    <td>
                      {e.employee?.name}
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {e.employee?.code} · {e.department?.nameTh || e.department?.name}
                      </div>
                    </td>
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
                    <td style={{ maxWidth: 240 }}>
                      {e.description}
                      {/* The row above is the request as it stands now. This
                          says it has not always said that — the values being
                          approved are a revision. */}
                      {editsOf(e).length > 0 && (
                        <div style={{ marginTop: 4 }}><EditedMark entry={e} /></div>
                      )}
                      {e.capExceeded && (
                        <div style={{ fontSize: 12, color: 'var(--amber)' }}>
                          ⚠ เกินเพดานแผนก ({e.capSnapshot?.capHours} ชม.)
                        </div>
                      )}
                      {e.warnings?.map((w) => (
                        <div key={w.code} style={{ fontSize: 12, color: 'var(--muted)' }}>{w.message}</div>
                      ))}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn sm" disabled={busy} onClick={() => approve(e)}>
                        {isHr ? 'ยืนยัน' : 'อนุมัติ'}
                      </button>
                      <button
                        className="btn ghost sm"
                        style={{ marginLeft: 6 }}
                        onClick={() => { setRejecting(e); setReason(''); }}
                      >
                        ไม่อนุมัติ
                      </button>
                      <button
                        className="btn ghost sm"
                        style={{ marginLeft: 6 }}
                        onClick={() => setExpanded(expanded === e._id ? null : e._id)}
                      >
                        {expanded === e._id ? 'ซ่อน' : 'รายละเอียด'}
                      </button>
                      {isHr && e.capExceeded && (
                        <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => override(e)}>
                          อนุมัติเกินเพดาน
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded === e._id && (
                    <tr>
                      <td colSpan={9} style={{ background: '#fafbfa' }}>
                        <strong style={{ fontSize: 13 }}>การแบ่งช่วงเวลา</strong>
                        <SegmentList segments={e.segments} />
                        {/* The row above shows the hours as they stand now.
                            This is where a reviewer sees whether they stood
                            somewhere else when the request was filed. */}
                        <strong style={{ fontSize: 13, display: 'block', marginTop: 12 }}>
                          ประวัติรายการ
                        </strong>
                        <EntryHistory entry={e} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rejecting && (
        <Modal
          title="ไม่อนุมัติรายการนี้"
          onClose={() => setRejecting(null)}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setRejecting(null)}>ยกเลิก</button>
              <button className="btn danger" disabled={busy || !reason.trim()} onClick={reject}>ยืนยันไม่อนุมัติ</button>
            </>
          )}
        >
          <div style={{ fontSize: 13, marginBottom: 10 }}>
            {rejecting.employee?.name} · {thaiDate(rejecting.workDate)} · {rejecting.startTime}–{rejecting.endTime}
          </div>
          <div className="field">
            <label>เหตุผล (พนักงานจะเห็นข้อความนี้)</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            พนักงานสามารถแก้ไขและส่งใหม่ได้
          </div>
        </Modal>
      )}
    </div>
  );
}
