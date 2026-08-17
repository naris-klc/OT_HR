'use client';

import React, { useEffect, useState } from 'react';
import { api, thaiDate, dayName, periodLabel } from '@/lib/api.js';
import { Alert, Empty, Changes, StatusChip, editsOf } from './common.jsx';
import { PolicyVersionChange } from './PolicyVersion.jsx';

const ACTION_LABEL = {
  edit: 'พนักงานแก้ไข',
  hr_edit: 'ฝ่ายบุคคลแก้ไข',
  /**
   * A replay only reaches this list when it kept a `before` — which is only
   * when it moved an already-approved entry's hours. It is not a correction
   * anybody typed, and reading it as one would put a person's name against a
   * change they did not make, so it is named for what it was.
   */
  recompute: 'คำนวณใหม่ตามนโยบาย',
};

/**
 * รายการการแก้ไข — one person's corrections for one month, newest first.
 *
 * ดู / แก้ไขรายการ answers "what does this row of the month consist of"; this
 * answers "what has been changed in it since it was filed". Reconciling against
 * the signed paper is the second question, and asking it of the first screen
 * means opening ข้อมูลเดิม on every row in turn to find the two that moved.
 *
 * Rows are the edits themselves rather than the entries carrying them, so the
 * order is the order the corrections happened in — three changes to one day and
 * one change to another read as four events, which is what an auditor is
 * counting.
 */
export default function HrEdits({ employee, period, status, onClose }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      setEntries(null);
      const res = await api.get(
        `/entries?employee=${employee._id}&period=${period}&status=${status}`,
      );
      setEntries(res.entries);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [employee._id, period, status]);

  // Flattened across entries: an edit belongs to the month before it belongs to
  // the day it corrected. `at` is stamped by the server on every history item,
  // but an entry written before that default existed can lack it — those sort
  // last rather than being dropped from a list of what happened.
  const edits = (entries || [])
    .flatMap((entry) => editsOf(entry).map((h) => ({ ...h, entry })))
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));

  const hrCount = edits.filter((h) => h.action === 'hr_edit').length;

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h2>ประวัติการแก้ไข — {employee.name}</h2>
          <div className="hint" style={{ margin: 0 }}>
            {employee.code} · {periodLabel(period)}
          </div>
        </div>
        <button className="btn ghost" onClick={onClose}>กลับไปสรุปรายเดือน</button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {!entries ? (
        <Empty>กำลังโหลด…</Empty>
      ) : edits.length === 0 ? (
        <Empty>เดือนนี้ไม่มีการแก้ไขหลังยื่นคำขอ</Empty>
      ) : (
        <>
          <div className="hint" style={{ marginTop: 12 }}>
            แก้ไขทั้งหมด {edits.length} ครั้ง ·
            {' '}ฝ่ายบุคคล {hrCount} ครั้ง ·
            {' '}พนักงาน {edits.length - hrCount} ครั้ง
          </div>

          <div className="table-wrap" style={{ marginTop: 8 }}>
            {/* `stack-table` + `data-label` is the phone layout every plain list
                in the app shares — see app/styles.css. */}
            <table className="stack-table">
              <thead>
                <tr>
                  <th>วันที่ทำ OT</th>
                  <th>แก้ไขเมื่อ</th>
                  <th>ผู้แก้ไข</th>
                  <th>เหตุผล</th>
                  <th>กฎที่ใช้</th>
                  <th>สิ่งที่เปลี่ยน</th>
                </tr>
              </thead>
              <tbody>
                {edits.map((h) => (
                  <tr key={`${h.entry._id}-${h.index}`}>
                    {/* The OT date is the card's heading — which row this change
                        was to. */}
                    <td className="stack-name">
                      {thaiDate(h.entry.workDate)}
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        วัน{dayName(h.entry.workDate)} · {h.entry.startTime}–{h.entry.endTime}
                      </div>
                      <div style={{ marginTop: 4 }}><StatusChip status={h.entry.status} /></div>
                    </td>
                    <td data-label="แก้ไขเมื่อ" style={{ whiteSpace: 'nowrap' }}>
                      {h.at ? new Date(h.at).toLocaleString('th-TH') : '—'}
                    </td>
                    <td data-label="ผู้แก้ไข">
                      {h.byName || '—'}
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {ACTION_LABEL[h.action] || h.action}
                      </div>
                    </td>
                    {/* HR must give a reason to edit; an employee correcting a
                        request the manager has not seen yet is not asked for
                        one, so a blank here is expected rather than missing. */}
                    <td data-label="เหตุผล">
                      {h.note || <span style={{ color: 'var(--muted)' }}>—</span>}
                    </td>
                    {/* Which rules each side of the change was computed under.
                        An edit and a policy change both move the hours in this
                        row; only this column tells them apart, and a correction
                        that crossed a version boundary changed two things at
                        once whether whoever made it meant to or not. */}
                    <td data-label="กฎที่ใช้">
                      <PolicyVersionChange before={h.before} after={h.after} />
                    </td>
                    {/* The change itself is the point of the card, and it is a list
                        rather than a value — full width, no label crowding it. */}
                    <td>
                      <Changes before={h.before} after={h.after} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="hint" style={{ marginTop: 12 }}>
        ใบ F-HR-027 พิมพ์ค่าล่าสุดเสมอ — ตารางนี้คือค่าเดิมที่ถูกแทนที่ในแต่ละครั้ง ·
        {' '}นับรวมรายการที่ถูกยื่นซ้ำและไม่ถูกนำไปคิดชั่วโมงด้วย
      </div>
    </div>
  );
}
