'use client';

import React, { useEffect, useState } from 'react';
import { api, hours, thaiDate, dayName, periodLabel, BUCKETS } from '@/lib/api.js';
import {
  Alert, Empty, EditedMark, EntryHistory, ProxyMark, RateHead, RequestTrail, StatusChip,
  editsOf, trailOf,
} from './common.jsx';
import { hasAuditTrail, isProxyFiled, isUntouchedSystemFiling } from '@/lib/entries.js';
import { describeBreaches } from '@/lib/caps.js';
import { versionSpread } from '@/lib/policyVersion.js';
import { PolicyVersionBanner, PolicyVersionCell } from './PolicyVersion.jsx';
import OtForm from './OtForm.jsx';
import { useBackHandler } from './nav.jsx';

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
  /**
   * How many refused requests this month's rows stand in for.
   *
   * The list has already dropped them (`replaced=hide`), and a table that
   * silently returns fewer rows than the database holds is a table nobody can
   * check. Kept beside `entries` and written in the same breath, so the figure
   * can never describe a list that has since been reloaded.
   */
  const [replacedCount, setReplacedCount] = useState(0);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  /**
   * Which rows have their history drawer open — a Set rather than a single id,
   * because closing a month means comparing rows against each other, and a
   * toggle that shuts the last row every time you open the next one makes that
   * impossible. It is also what lets one press open all of them.
   */
  const [open, setOpen] = useState(() => new Set());

  async function load() {
    try {
      setEntries(null);
      // One row per line of filing. A request the employee re-filed after a
      // refusal is represented by the request that replaced it — the same
      // evening listed twice, once closed and once live, is the thing this
      // screen is least able to afford. Nothing is lost: the drawer on the
      // surviving row draws both requests in full.
      const res = await api.get(
        `/entries?employee=${employee._id}&period=${period}&replaced=hide`,
      );
      setEntries(res.entries);
      setReplacedCount(res.replacedCount || 0);
      setError('');
    } catch (err) { setError(err.message); }
  }

  useEffect(() => { load(); }, [employee._id, period]);

  // The header mark unwinds this before the tab underneath it.
  useBackHandler(Boolean(editing), () => setEditing(null));

  // A drawer left open over a row that no longer exists — a different month,
  // a reloaded list — would never be closed by anything.
  useEffect(() => { setOpen(new Set()); }, [employee._id, period]);

  const auditable = (entries || []).filter(hasAuditTrail);

  /**
   * Computed from the rows on screen rather than fetched.
   *
   * `policyVersionId` arrives populated on each entry, so the spread is already
   * in hand — and taking it from the same array the table renders is what stops
   * the banner describing a month the list below it no longer shows. The
   * snapshots themselves are not here, so `arithmeticMixed` is null and the
   * banner says it cannot tell whether the numbers compare; the month-level
   * banner on ตรวจสอบรายเดือน has the snapshots and answers that.
   */
  const spread = versionSpread(entries || []);
  const allOpen = auditable.length > 0 && auditable.every((e) => open.has(e._id));

  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAll = () => setOpen(allOpen ? new Set() : new Set(auditable.map((e) => e._id)));

  /**
   * ถอนใบวันเกิด — through the same `/cancel` endpoint an employee withdraws
   * their own request with. The server decides which of the two acts it is and
   * logs `void` rather than `cancel`; this screen only has to ask.
   */
  async function voidEntry(entry) {
    try {
      await api.post(`/entries/${entry._id}/cancel`, { note: 'ถอนใบวันเกิดที่ระบบสร้าง' });
      await load();
      onChanged?.();
    } catch (err) { setError(err.message); }
  }

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
        <>
        <PolicyVersionBanner spread={spread} />

        {/* One press to read the whole month at once, which is what closing it
            actually involves — the per-row buttons are for following a single
            figure that looks wrong. Disabled rather than hidden when no row in
            the month has anything to show, so the control does not appear and
            disappear between months. */}
        <div className="audit-bar">
          <label className={auditable.length ? 'check' : 'check off'}>
            <input
              type="checkbox"
              checked={allOpen}
              disabled={!auditable.length}
              onChange={toggleAll}
            />
            แสดงประวัติการแก้ไขทั้งหมด
          </label>
          <span className="hint">
            {auditable.length
              ? `${auditable.length} จาก ${entries.length} รายการมีประวัติให้ดู`
              : 'เดือนนี้ยังไม่มีรายการใดถูกแก้ไขหรือคำนวณใหม่'}
          </span>
        </div>

        {/* Said on the screen rather than left as a gap in the table. The rows
            are not deleted and not merely filtered — each one is folded into
            the request that replaced it, and the sentence points at the button
            that opens it. */}
        {replacedCount > 0 && (
          <div className="hint" style={{ marginTop: 6 }}>
            ซ่อน {replacedCount} คำขอเดิมที่ถูกไม่อนุมัติและพนักงานส่งใหม่แล้ว ·
            {' '}ตารางนี้แสดงคำขอล่าสุดของแต่ละเรื่องเพียงแถวเดียว ·
            {' '}กด “ดูข้อมูลเดิม” ที่แถวนั้นเพื่อดูคำขอเดิม เวลาเดิม และเหตุผลที่ไม่อนุมัติ
          </div>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>วันที่</th>
                <th>จาก–ถึง</th>
                <th className="num rate-col"><RateHead rate="×1.5" of="ปกติ" /></th>
                <th className="num rate-col wide"><RateHead rate="×1.5" of="วันหยุด" /></th>
                <th className="num rate-col wide"><RateHead rate="×3" of="วันหยุด" /></th>
                <th className="num">รวม</th>
                <th>รายละเอียดงานที่ทำ</th>
                <th>กฎที่ใช้</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                // The last correction of any kind, not only HR's: an employee
                // who revised the request before the manager saw it changed the
                // hours in this row just as surely, and HR reconciling against
                // the paper needs to know that as much as its own edits.
                const lastEdit = [...editsOf(e)].pop();
                const closed = ['rejected', 'cancelled'].includes(e.status);
                return (
                  <React.Fragment key={e._id}>
                  <tr>
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
                    <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT15_WEEKDAY])}</td>
                    <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT15_HOLIDAY])}</td>
                    <td className="num rate-col">{hours(e.buckets?.[BUCKETS.OT3_HOLIDAY])}</td>
                    <td className="num"><strong>{hours(e.totals?.otHours)}</strong></td>
                    <td>
                      {e.description}
                      {/* ฝ่ายบุคคล reconciling a month against the signed paper
                          are asking who stands behind each row. A request the
                          หัวหน้า wrote and the employee never touched is a
                          different thing to check than one the employee filed,
                          and the two are indistinguishable without this. */}
                      {isProxyFiled(e) && (
                        <div style={{ marginTop: 4 }}><ProxyMark entry={e} /></div>
                      )}
                      {lastEdit && (
                        <div style={{ marginTop: 4 }}>
                          <EditedMark entry={e} />
                          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                            โดย {lastEdit.byName || '—'}
                            {lastEdit.note ? ` — ${lastEdit.note}` : ''}
                          </div>
                        </div>
                      )}
                    </td>
                    {/* The row this screen exists to answer questions about.
                        Beside the hours rather than in the drawer: which rules
                        produced a figure is part of reading it, not part of
                        investigating it. */}
                    <td><PolicyVersionCell version={e.policyVersionId} /></td>
                    <td>
                      <StatusChip status={e.status} />
                      {describeBreaches(e).map((b) => (
                        <div
                          key={b.scope + b.text}
                          style={{ fontSize: 11.5, color: 'var(--amber)' }}
                          title={b.text}
                        >
                          เกินเพดานราย{b.scope === 'week' ? 'สัปดาห์' : 'เดือน'}
                        </div>
                      ))}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {closed ? (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>แก้ไขไม่ได้</span>
                      ) : (
                        <button className="btn ghost sm" onClick={() => setEditing(e)}>แก้ไข</button>
                      )}
                      {/* A row the system wrote and nobody has touched: the one
                          approved entry HR may take off the books, because it is
                          a proposal they accepted rather than an account anybody
                          gave of hours worked. The button disappears the moment
                          the row is edited or signed — see
                          `isUntouchedSystemFiling`. */}
                      {isUntouchedSystemFiling(e) && (
                        <button
                          className="btn ghost sm"
                          style={{ marginLeft: 6 }}
                          onClick={() => voidEntry(e)}
                          title="ถอนใบวันเกิดที่ระบบสร้าง — ชั่วโมงนี้จะไม่ถูกนับในใบส่งบัญชี"
                        >
                          ถอนใบวันเกิด
                        </button>
                      )}
                      {/* Reconciling a month against the signed paper means
                          reading what the row used to say, not only what it
                          says now — which is the one thing the printed form
                          cannot tell HR.
                          A row that has only ever been filed says so rather
                          than losing its button: an absent control reads as a
                          screen that forgot, a disabled one as an answer. */}
                      {hasAuditTrail(e) ? (
                        <button
                          className={open.has(e._id) ? 'btn ghost sm on' : 'btn ghost sm'}
                          style={{ marginLeft: 6 }}
                          onClick={() => toggle(e._id)}
                          aria-expanded={open.has(e._id)}
                        >
                          {open.has(e._id) ? 'ซ่อนข้อมูลเดิม' : 'ดูข้อมูลเดิม'}
                        </button>
                      ) : (
                        <button className="btn ghost sm" style={{ marginLeft: 6 }} disabled>
                          ไม่มีประวัติการแก้ไข
                        </button>
                      )}
                    </td>
                  </tr>
                  {open.has(e._id) && (
                    <tr className="audit-row">
                      <td colSpan={10}>
                        <div className="audit-drawer">
                          <strong>ประวัติการแก้ไข</strong>
                          <div className="hint" style={{ margin: '2px 0 0' }}>
                            แถวด้านบนคือข้อมูลล่าสุดที่พิมพ์ลงใบ F-HR-027 ·
                            ด้านล่างนี้คือทุกครั้งที่รายการนี้ถูกแตะ พร้อมค่าเดิมก่อนแก้แต่ละครั้ง
                            {e.refiledFrom && ' · รวมคำขอเดิมที่ถูกไม่อนุมัติ'}
                          </div>
                          {/* A re-filed request's own log starts at submit and
                              explains nothing. The refusal that produced it is
                              in the parent, already populated on this row. */}
                          {trailOf(e)
                            ? <RequestTrail requests={trailOf(e)} liveStatus={e.status} />
                            : <EntryHistory entry={e} />}
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      <div className="hint" style={{ marginTop: 12 }}>
        การแก้ไขของฝ่ายบุคคลจะคำนวณชั่วโมงใหม่ทันทีและคงสถานะการอนุมัติเดิมไว้ ·
        รายการที่ไม่อนุมัติหรือยกเลิกแล้วต้องให้พนักงานส่งใหม่
      </div>
    </div>
  );
}
