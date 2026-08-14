'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, dayName } from '@/lib/api.js';
import { Alert, Modal, StatusChip } from './common.jsx';

/**
 * คำขอถอนใบที่อนุมัติแล้ว — the reviewer's side of lib/withdrawal.js.
 *
 * Its own component and its own fetch rather than a section inside
 * ApprovalQueue, because the rows are not a queue in that screen's sense: they
 * are `approved` and `pending_hr` entries, they are not waiting for a signature,
 * and none of the machinery around them — the tick boxes, the batch bar, the
 * cap columns — applies to a decision about whether hours should come back off
 * the books. Sharing the table would have meant teaching every one of those
 * features to skip these rows.
 *
 * It is deliberately NOT batchable. Granting takes a figure two people signed
 * off a month that may already be half-reported; the reason each employee gave
 * is different, and the whole point of the feature is that somebody read it.
 * The same argument the queue makes for never batching a rejection.
 */
export default function WithdrawalRequests({ user, onChanged }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refusing, setRefusing] = useState(null); // entry
  const [refuseNote, setRefuseNote] = useState('');
  const [granting, setGranting] = useState(null); // entry

  async function load() {
    try {
      const res = await api.get('/entries?withdrawal=open&limit=200');
      setRows(res.entries);
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, []);

  async function decide(entry, granted, note) {
    setBusy(true);
    try {
      await api.post(`/entries/${entry._id}/withdraw/decide`, { granted, note: note || undefined });
      setRefusing(null);
      setGranting(null);
      setRefuseNote('');
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  /**
   * Nothing at all when there is nothing waiting — no empty card, no zero.
   *
   * This sits above a queue somebody works every day, and a permanent empty
   * panel for a thing that happens a few times a month is a row of furniture
   * they learn to read past. When it does appear it should be new.
   */
  if (!rows?.length) {
    return error ? <Alert kind="error">{error}</Alert> : null;
  }

  return (
    <div className="card flush">
      <div className="card-head">
        <div>
          <div className="t">คำขอถอนใบที่อนุมัติแล้ว</div>
          <div className="hint" style={{ margin: '3px 0 0' }}>
            พนักงานขอถอนรายการที่มีผู้อนุมัติไปแล้ว · รายการเหล่านี้
            <strong>ยังมีผลและยังถูกนับอยู่</strong>จนกว่าจะอนุมัติให้ถอน
          </div>
        </div>
        <span className="chip muted">{rows.length} คำขอ</span>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {rows.map((e) => (
        <div className="item" key={e._id}>
          <div className="date">
            <div className="n">{Number(e.workDate.slice(8, 10))}</div>
            <div className="c">{dayName(e.workDate).slice(0, 2)}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: '500 14.5px/1.4 var(--sans)' }}>
              {e.employee?.name}
              <span className="hint" style={{ marginLeft: 6 }}>
                {e.employee?.code} · {e.department?.nameTh || e.department?.name}
              </span>
            </div>
            <div className="hint">
              {thaiDate(e.workDate)} · {e.startTime}–{e.endTime} · {e.description}
            </div>
            {/* The reason is the whole of what is being decided, so it is not
                behind a button. A reviewer who has to open something to find
                out why they are being asked will approve on the strength of
                the fact that they were asked. */}
            <div style={{ marginTop: 4, font: '500 13px/1.5 var(--sans)' }}>
              เหตุผลที่ขอถอน: {e.withdrawal?.reason}
            </div>
            <div className="hint">
              ขอโดย {e.withdrawal?.requestedByName}
              {e.withdrawal?.requestedAt && ` · ${thaiDate(String(e.withdrawal.requestedAt).slice(0, 10))}`}
            </div>
          </div>
          <div className="num" style={{ font: '600 16px/1 var(--mono)', flex: 'none' }}>
            {hours(e.totals?.otHours)}
            <span style={{ font: '400 11px/1 var(--sans)', color: 'var(--muted-2)' }}> ชม.</span>
          </div>
          <StatusChip status={e.status} />
          <div className="row" style={{ gap: 6, flex: 'none' }}>
            <button className="btn ghost sm" disabled={busy} onClick={() => { setRefusing(e); setRefuseNote(''); }}>
              ไม่อนุมัติ
            </button>
            <button className="btn danger sm" disabled={busy} onClick={() => setGranting(e)}>
              อนุมัติให้ถอน
            </button>
          </div>
        </div>
      ))}

      {granting && (
        <Modal
          title="อนุมัติให้ถอนใบนี้"
          subtitle={`${granting.employee?.name} · ${thaiDate(granting.workDate)} · ${hours(granting.totals?.otHours)} ชม.`}
          onClose={() => setGranting(null)}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setGranting(null)}>ยังไม่อนุมัติ</button>
              <button className="btn danger" disabled={busy} onClick={() => decide(granting, true)}>
                ยืนยันการถอนใบ
              </button>
            </>
          )}
        >
          <div style={{ font: '500 14px/1.6 var(--sans)' }}>
            เหตุผลที่พนักงานแจ้ง: {granting.withdrawal?.reason}
          </div>
          {/* Said before anything else, because this is the button that moves
              money. The entry has been signed by at least one person and its
              hours are in the month's totals; a reviewer who thought this
              merely "acknowledged" the request would be surprised twice. */}
          <Alert kind="warn">
            รายการจะเปลี่ยนเป็น “ยกเลิก” ทันทีและ<strong>แก้กลับไม่ได้</strong> —
            ชั่วโมง {hours(granting.totals?.otHours)} ชม. จะถูกตัดออกจากเดือนนี้
            ทั้งจากเพดานของแผนกและจากรายงานส่งบัญชี
          </Alert>
          <div className="hint">
            ประวัติรายการจะบันทึกทั้งคำขอของพนักงานและการอนุมัติของคุณ พร้อมวันเวลาและเหตุผล
          </div>
        </Modal>
      )}

      {refusing && (
        <Modal
          title="ไม่อนุมัติคำขอถอนใบ"
          subtitle={`${refusing.employee?.name} · ${thaiDate(refusing.workDate)}`}
          onClose={() => setRefusing(null)}
          dirty={refuseNote.trim().length > 0}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setRefusing(null)}>ปิด</button>
              <button
                className="btn"
                disabled={busy || !refuseNote.trim()}
                onClick={() => decide(refusing, false, refuseNote.trim())}
              >
                ยืนยันไม่อนุมัติ
              </button>
            </>
          )}
        >
          <div style={{ font: '500 14px/1.6 var(--sans)' }}>
            เหตุผลที่พนักงานแจ้ง: {refusing.withdrawal?.reason}
          </div>
          <div className="field">
            <label>เหตุผลที่ไม่อนุมัติ</label>
            <input
              value={refuseNote}
              onChange={(ev) => setRefuseNote(ev.target.value)}
              maxLength={200}
              placeholder="เช่น ตรวจกับบันทึกเวลาสแกนนิ้วแล้ว มีการเข้าทำงานจริง"
              autoFocus
            />
            {/* Required for the reason a rejection's is: the employee asked a
                question and will read the answer, and "ไม่อนุมัติ" on its own
                sends them back to asking somebody in person — which is the
                conversation this feature exists to bring inside the system. */}
            <span className="field-note">จำเป็นต้องกรอก — พนักงานจะเห็นข้อความนี้บนรายการ</span>
          </div>
          <div className="hint">
            รายการยังมีผลตามเดิม ไม่มีอะไรเปลี่ยน · พนักงานยื่นขอถอนใหม่ได้หากมีเหตุผลเพิ่มเติม
          </div>
        </Modal>
      )}
    </div>
  );
}
