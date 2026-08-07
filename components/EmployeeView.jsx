'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, dayName, currentPeriod, periodLabel, BUCKETS } from '@/lib/api.js';
import { StatusChip, Alert, Empty, EditedMark, EntryHistory, Modal, editsOf } from './common.jsx';
import OtForm from './OtForm.jsx';

export default function EmployeeView({ user, onChanged, openSignal = 0 }) {
  const [entries, setEntries] = useState([]);
  const [usage, setUsage] = useState(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [reusing, setReusing] = useState(null); // rejected entry being sent again
  const [editing, setEditing] = useState(null); // own entry, still pending_mgr
  const [showForm, setShowForm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showHistory, setShowHistory] = useState(null); // entry id, in the full table
  const [cancelling, setCancelling] = useState(null);   // own entry being withdrawn
  const [cancelNote, setCancelNote] = useState('');
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

  // The mobile FAB lives in the shell, so it asks for the form by bumping a counter.
  useEffect(() => { if (openSignal > 0) setShowForm(true); }, [openSignal]);

  /**
   * Withdrawing a request is a step in its history, not a delete — the row
   * stays, marked ยกเลิก. The reason rides along so the ประวัติรายการ can say
   * why it stopped rather than only that it did, and asking for it takes the
   * place of a bare confirm() that explained nothing either way.
   */
  async function cancel() {
    try {
      await api.post(`/entries/${cancelling._id}/cancel`, { note: cancelNote.trim() || undefined });
      setCancelling(null);
      setCancelNote('');
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); }
  }

  if (!user.maySubmitOt) {
    return (
      <div className="stack">
        <div className="card">
          <h2>ตำแหน่งนี้ไม่บันทึก OT</h2>
          <div className="hint">
            หัวหน้างานไม่มีสิทธิ์ขอ OT ตามข้อกำหนดของระบบ — ใช้แท็บ “รออนุมัติ” เพื่อตรวจรายการของทีม
          </div>
        </div>
      </div>
    );
  }

  if (showForm || reusing || editing) {
    return (
      <div className="stack">
        {error && <Alert kind="error">{error}</Alert>}
        {/* `editing` corrects the stored row in place; `template` files a new
            request from an old one. Same fields, different write. */}
        <OtForm
          entry={editing}
          template={reusing}
          onSaved={() => { setShowForm(false); setReusing(null); setEditing(null); load(); onChanged?.(); }}
          onCancel={() => { setShowForm(false); setReusing(null); setEditing(null); }}
        />
      </div>
    );
  }

  const monthEntries = entries.filter((e) => e.period === period);
  const sumBy = (pred) => monthEntries
    .filter(pred)
    .reduce((n, e) => n + (e.totals?.otHours || 0), 0);

  const approvedHours = sumBy((e) => e.status === 'approved');
  const pendingHours = sumBy((e) => e.status === 'pending_mgr' || e.status === 'pending_hr');

  const cap = usage?.capHours ?? null;
  const used = usage?.usedHours ?? 0;
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  const remain = cap != null ? Math.max(0, cap - used) : null;
  const over = cap != null && used > cap;

  const buckets = usage?.summary?.buckets || {};
  const recent = monthEntries.slice(0, 5);

  return (
    <div className="stack">
      {error && <Alert kind="error">{error}</Alert>}

      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <div className="hero">
        <div>
          <div className="cap">ชั่วโมง OT · {periodLabel(period)}</div>
          <div className="big">
            <span>{hours(usage?.summary?.otHours ?? 0)}</span>
            <span className="unit">ชั่วโมง</span>
          </div>
          {cap != null ? (
            <>
              <div className={over ? 'meter over' : 'meter'}>
                <i style={{ width: `${pct}%` }} />
              </div>
              <div className="sub">
                เพดาน {cap} ชม./เดือน · {over
                  ? `เกิน ${hours(used - cap)} ชม.`
                  : `เหลือ ${hours(remain)} ชม.`}
                {usage?.basis === 'weighted' && ' · นับแบบคูณอัตรา'}
              </div>
            </>
          ) : (
            <div className="sub" style={{ marginTop: 14 }}>แผนกนี้ไม่กำหนดเพดานชั่วโมงต่อเดือน</div>
          )}
        </div>

        <div>
          <div className="cap">สถานะชั่วโมง</div>
          <div className="big">
            <span className="mid">{hours(approvedHours)}</span>
            <span className="unit" style={{ fontSize: 13 }}>ชม. อนุมัติแล้ว</span>
          </div>
          <div className="sub">รออนุมัติอีก {hours(pendingHours)} ชม.</div>
        </div>

        <div className="hero-actions">
          <button className="btn" onClick={() => setShowForm(true)}>+ บันทึก OT ใหม่</button>
          <button className="btn on-dark" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'ย่อประวัติ' : 'ดูประวัติทั้งหมด'}
          </button>
        </div>
      </div>

      {/* ── the three rate buckets ───────────────────────────────────────── */}
      <div className="grid">
        <Stat
          label="OT วันปกติ ×1.5"
          value={hours(buckets[BUCKETS.OT15_WEEKDAY] ?? 0)}
          note="หลัง 17:00 น. ของวันทำงาน"
        />
        <Stat
          label="OT วันหยุด ×1.5"
          value={hours(buckets[BUCKETS.OT15_HOLIDAY] ?? 0)}
          note="วันหยุด ช่วง 08:00–17:00 น."
        />
        <Stat
          label="OT วันหยุด ×3"
          value={hours(buckets[BUCKETS.OT3_HOLIDAY] ?? 0)}
          note="วันหยุด นอกเวลา 08:00–17:00 น."
        />
      </div>

      {/* ── recent ───────────────────────────────────────────────────────── */}
      {!showAll && (
        <div className="card flush">
          <div className="card-head">
            <span className="t">รายการล่าสุด · {periodLabel(period)}</span>
            <div className="row" style={{ gap: 8, flex: 'none' }}>
              <input
                className="period-input"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
              <button className="link" onClick={() => setShowAll(true)}>ทั้งหมด →</button>
            </div>
          </div>
          {recent.length === 0 ? (
            <Empty>ยังไม่มีรายการในเดือนนี้</Empty>
          ) : recent.map((e) => (
            <div className="item" key={e._id}>
              <div className={`date${e.buckets?.[BUCKETS.OT15_WEEKDAY] ? '' : ' holiday'}`}>
                <div className="n">{Number(e.workDate.slice(8, 10))}</div>
                <div className="c">{dayName(e.workDate).slice(0, 2)}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: '500 14.5px/1.4 var(--sans)' }}>{e.description}</div>
                <div className="hint">
                  {e.startTime}–{e.endTime}
                  {e.endsNextDay && ' · ข้ามคืน'}
                  {e.noBreakTaken && ' · ไม่พักเที่ยง'}
                </div>
              </div>
              <div className="num" style={{ font: '600 16px/1 var(--mono)', flex: 'none' }}>
                {hours(e.totals?.otHours)}
                <span style={{ font: '400 11px/1 var(--sans)', color: 'var(--muted-2)' }}> ชม.</span>
              </div>
              <StatusChip status={e.status} />
              {e.status === 'pending_mgr' && (
                <button className="btn ghost sm" style={{ flex: 'none' }} onClick={() => setEditing(e)}>
                  แก้ไข
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── full history ─────────────────────────────────────────────────── */}
      {showAll && (
        <div className="card">
          <div className="row" style={{ alignItems: 'center', marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <h2>ประวัติการขอ OT · {periodLabel(period)}</h2>
              <div className="hint" style={{ margin: 0 }}>
                แก้ไขวันที่ เวลา และรายละเอียดเองได้เฉพาะรายการที่ยังรอหัวหน้าอนุมัติ ·
                เมื่อหัวหน้าหรือฝ่ายบุคคลอนุมัติแล้ว ต้องให้ฝ่ายบุคคลเป็นผู้แก้ไข ·
                รายการที่ไม่อนุมัติ กด “ส่งใหม่” เพื่อยื่นคำขอใหม่จากข้อมูลเดิมได้
              </div>
            </div>
            <div className="field" style={{ maxWidth: 180, flex: 'none' }}>
              <label>ประจำเดือน</label>
              <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </div>
          </div>

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
                    <React.Fragment key={e._id}>
                    <tr>
                      <td>
                        {thaiDate(e.workDate)}
                        <div className="hint">วัน{dayName(e.workDate)}</div>
                      </td>
                      <td>
                        {e.startTime}–{e.endTime}
                        {e.endsNextDay && <div style={{ fontSize: 12, color: 'var(--amber)' }}>ข้ามคืน</div>}
                        {e.noBreakTaken && <div className="hint">ไม่พักเที่ยง</div>}
                      </td>
                      <td className="num">{hours(e.buckets?.[BUCKETS.OT15_WEEKDAY])}</td>
                      <td className="num">{hours(e.buckets?.[BUCKETS.OT15_HOLIDAY])}</td>
                      <td className="num">{hours(e.buckets?.[BUCKETS.OT3_HOLIDAY])}</td>
                      <td className="num"><strong>{hours(e.totals?.otHours)}</strong></td>
                      <td style={{ maxWidth: 260 }}>
                        {e.description}
                        {editsOf(e).length > 0 && (
                          <div style={{ marginTop: 4 }}><EditedMark entry={e} /></div>
                        )}
                        {e.rejectionReason && (
                          <div style={{ fontSize: 12, color: 'var(--danger-ink)' }}>
                            เหตุผล: {e.rejectionReason}
                          </div>
                        )}
                      </td>
                      <td><StatusChip status={e.status} /></td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {/* Only while nobody has signed it. Once the manager
                            approves, the hours carry a decision and the row is
                            HR's to correct. */}
                        {e.status === 'pending_mgr' && (
                          <>
                            <button className="btn ghost sm" onClick={() => setEditing(e)}>แก้ไข</button>
                            <button
                              className="btn ghost sm"
                              style={{ marginLeft: 6 }}
                              onClick={() => { setCancelling(e); setCancelNote(''); }}
                            >
                              ยกเลิก
                            </button>
                          </>
                        )}
                        {/* Not an edit: it fills a blank form from this row and
                            submits a new request. The rejected one stays put. */}
                        {e.status === 'rejected' && (
                          <button className="btn ghost sm" style={{ marginLeft: 6 }} onClick={() => setReusing(e)}>
                            ส่งใหม่
                          </button>
                        )}
                        {/* Offered only on rows that were actually rewritten —
                            on the rest there is no earlier version to show, and
                            a button that opens "ยื่นคำขอ" alone is noise. */}
                        {editsOf(e).length > 0 && (
                          <button
                            className="btn ghost sm"
                            style={{ marginLeft: 6 }}
                            onClick={() => setShowHistory(showHistory === e._id ? null : e._id)}
                          >
                            {showHistory === e._id ? 'ซ่อนข้อมูลเดิม' : 'ข้อมูลเดิม'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {showHistory === e._id && (
                      <tr>
                        <td colSpan={9} style={{ background: 'var(--neutral-wash)' }}>
                          <strong style={{ fontSize: 13 }}>ประวัติการแก้ไข</strong>
                          <div className="hint" style={{ margin: '2px 0 0' }}>
                            แถวด้านบนคือข้อมูลล่าสุด ซึ่งเป็นข้อมูลที่พิมพ์ลงใบ F-HR-027 ·
                            ด้านล่างนี้คือข้อมูลเดิมที่เคยกรอกไว้ก่อนการแก้ไขแต่ละครั้ง
                          </div>
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
        </div>
      )}

      {cancelling && (
        <Modal
          title="ยกเลิกคำขอนี้"
          subtitle={`${thaiDate(cancelling.workDate)} · ${cancelling.startTime}–${cancelling.endTime} · ${hours(cancelling.totals?.otHours)} ชม.`}
          onClose={() => setCancelling(null)}
          dirty={cancelNote.trim().length > 0}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setCancelling(null)}>ไม่ยกเลิกแล้ว</button>
              <button className="btn danger" onClick={cancel}>ยืนยันการยกเลิก</button>
            </>
          )}
        >
          <div className="field">
            <label>เหตุผลที่ยกเลิก</label>
            <input
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              maxLength={500}
              placeholder="เช่น หัวหน้าให้เลื่อนงานไปวันอื่น"
              autoFocus
            />
            <span className="field-note">ไม่บังคับ — ถ้ากรอก จะบันทึกไว้ในประวัติรายการ</span>
          </div>
          <div className="hint">
            รายการจะยังอยู่ในตารางโดยขึ้นสถานะ “ยกเลิก” ไม่ได้ถูกลบทิ้ง ·
            {' '}หากต้องการขอ OT ช่วงเวลานี้อีกครั้ง ให้บันทึกคำขอใหม่
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">
        <span>{value}</span>
        <span className="unit">ชม.</span>
      </div>
      <div className="note">{note}</div>
    </div>
  );
}
