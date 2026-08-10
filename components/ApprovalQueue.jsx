'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  api, hours, thaiDate, dayName, periodLabel, BUCKETS, BUCKET_LABEL,
} from '@/lib/api.js';
import { describeBreaches } from '@/lib/caps.js';
import { isProxyFiled, isSystemFiled, isUntouchedSystemFiling } from '@/lib/entries.js';
// The same predicate `approvalPermission` refuses on, so the buttons this screen
// offers and the ones the server accepts cannot drift apart.
import { isOwnFiling } from '@/lib/delegation.js';
import {
  Alert, Empty, EditedMark, EntryHistory, Modal, ProxyMark, RefiledNote, RequestTrail,
  SegmentList, StatusChip, TeamMark, editsOf,
} from './common.jsx';
import { PolicyDriftBanner } from './PolicyVersion.jsx';
import OtForm from './OtForm.jsx';
import { useToast } from './Toast.jsx';

/**
 * Manager review (daily) and HR confirmation (monthly) are the same table with
 * a different queue behind it (§2), so they share this component.
 *
 * HR's queue is the one that grows: a month closes with every department's
 * approved requests landing in it at once, and a screen built for reading one
 * row at a time turns that into an afternoon of clicking. Everything below the
 * heading — the filters, the tick boxes, the batch bar — exists so a reviewer
 * can narrow a hundred rows down to the ones they are actually deciding about,
 * and then decide about them together.
 *
 * What is NOT batched: rejection. A refusal carries a reason the employee will
 * read, so even the batch path stops for one to be typed.
 */
export default function ApprovalQueue({ user, stage, onChanged, onOpenPolicy, delegatedOnly = false }) {
  const isHr = stage === 'pending_hr';
  const verb = isHr ? 'ยืนยัน' : 'อนุมัติ';
  const toast = useToast();

  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total } during a batch

  // ── filters ───────────────────────────────────────────────────────────────
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [per, setPer] = useState('');

  // ── standing in ───────────────────────────────────────────────────────────
  /**
   * The queues this person is covering for somebody else, if any.
   *
   * The rows arrive mixed in with their own — one list, because approving is
   * the same act either way and two tables would mean two batch bars. What
   * cannot be mixed is WHOSE team a row is from: the reviewer is signing under
   * a different person's authority on some of these, and a queue that does not
   * say which is which is a queue where that goes unnoticed.
   */
  const [holding, setHolding] = useState([]);
  const covered = useMemo(
    () => holding.map((d) => d.from?.departmentId).filter(Boolean),
    [holding],
  );

  useEffect(() => {
    // Only the queues where standing in can be the reason a row is on screen.
    // The HR confirmation queue is nobody's to lend — see approvalPermission.
    if (isHr) return;
    api.get('/delegations')
      .then((res) => setHolding(res.holding || []))
      .catch(() => setHolding([])); // not fatal — the queue still works
  }, [isHr]);

  // ── filing on somebody's behalf ───────────────────────────────────────────
  const [filing, setFiling] = useState(false);

  // ── selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState(() => new Set());
  const allRef = useRef(null);

  // ── modals ────────────────────────────────────────────────────────────────
  const [confirming, setConfirming] = useState(null); // entry[]
  const [rejecting, setRejecting] = useState(null);   // entry[] — batch only
  const [overriding, setOverriding] = useState(null); // entry
  const [detail, setDetail] = useState(null);         // entry

  /** Was there ever something in this queue this session? Drives the two
      different empty states — "nothing came in" vs "you just cleared it". */
  const everHadRows = useRef(false);

  async function load() {
    try {
      // `scope=delegated` narrows to the covered teams instead of widening the
      // caller's own reach — the difference between a ฝ่ายบุคคล seeing the one
      // queue they were handed and seeing every pending request in the company.
      const res = await api.get(`/entries?status=${stage}${delegatedOnly ? '&scope=delegated' : ''}`);
      setEntries(res.entries);
      if (res.entries.length) everHadRows.current = true;
      return res.entries;
    } catch (err) { setError(err.message); return null; }
  }

  useEffect(() => {
    setEntries(null);
    setSelected(new Set());
    everHadRows.current = false;
    load();
  }, [stage, delegatedOnly]);

  // ── what the table is showing ─────────────────────────────────────────────

  const departments = useMemo(() => optionsBy(entries, (e) => [
    e.department?._id, e.department?.nameTh || e.department?.name,
  ]), [entries]);

  const periods = useMemo(() => optionsBy(entries, (e) => [
    e.period, periodLabel(e.period),
  ]), [entries]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (entries || []).filter((e) => (
      (!dept || String(e.department?._id) === dept)
      && (!per || e.period === per)
      && (!needle || haystack(e).includes(needle))
    ));
  }, [entries, q, dept, per]);

  /** How much of this queue is somebody else's team. */
  const coveredCount = useMemo(
    () => (entries || []).filter((e) => covered.some(
      (id) => String(id) === String(e.department?._id),
    )).length,
    [entries, covered],
  );

  /**
   * A tick survives only as long as its row is on screen. Confirming a batch
   * that quietly included rows a filter had hidden is the one way this screen
   * could approve something nobody looked at.
   */
  useEffect(() => {
    setSelected((prev) => {
      if (!prev.size) return prev;
      const live = new Set(shown.map((e) => e._id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [shown]);

  /**
   * The rows this reviewer can actually decide — everything except the ones they
   * filed themselves, which no button of theirs can move (see `isOwnFiling`).
   * เลือกทั้งหมด and the tick-box state are both counted against this rather than
   * against `shown`, so a batch cannot be built out of rows that will 403.
   */
  const actionable = useMemo(() => shown.filter((e) => !isOwnFiling(e, user)), [shown, user]);

  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = selected.size > 0 && selected.size < actionable.length;
    }
  }, [selected, actionable]);

  const picked = shown.filter((e) => selected.has(e._id));
  const pickedHours = picked.reduce((n, e) => n + (e.totals?.otHours || 0), 0);
  const filtered = entries && shown.length !== entries.length;

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const toggleAll = () => setSelected(
    selected.size === actionable.length ? new Set() : new Set(actionable.map((e) => e._id)),
  );

  // ── actions ───────────────────────────────────────────────────────────────

  /**
   * One request per entry, in order, because the API has no bulk endpoint and
   * inventing one that half-succeeds is worse than a progress counter. A row
   * that fails is named rather than swallowed: the rest of the batch still went
   * through, and the reviewer has to know which ones did not.
   */
  async function run(list, act, done) {
    setBusy(true);
    setError('');
    setProgress({ done: 0, total: list.length });
    const failed = [];
    for (const e of list) {
      try {
        await act(e);
      } catch (err) {
        failed.push(`${e.employee?.name || '—'} ${thaiDate(e.workDate)} — ${err.message}`);
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }
    setProgress(null);
    setSelected(new Set());
    await load();
    setBusy(false);

    const ok = list.length - failed.length;
    if (ok > 0) {
      // Which badge just went down. The covered queue has a counter of its own,
      // and taking a row off the manager's number instead would move the wrong
      // one on screen until the refresh behind it landed.
      onChanged?.(delegatedOnly ? 'delegated' : stage, ok);
      toast(done(ok, list));
    }
    if (failed.length) {
      const msg = `ทำรายการไม่สำเร็จ ${failed.length} รายการ · ${failed.join(' · ')}`;
      setError(msg);
      toast(`ทำรายการไม่สำเร็จ ${failed.length} รายการ — ดูรายละเอียดด้านบนตาราง`, 'error');
    }
  }

  const approve = (list) => run(
    list,
    (e) => api.post(`/entries/${e._id}/approve`),
    (n, all) => (n === 1
      ? `${verb}รายการ OT ของ ${all[0].employee?.name} เรียบร้อยแล้ว`
      : `${verb} ${n} รายการเรียบร้อยแล้ว${isHr ? ' — เข้าสู่รายงานส่งออกแล้ว' : ''}`),
  );

  // The landing status is a policy flag (hrRejectReturnsTo), so the message
  // says what is certain — the reason is on the record — rather than guessing
  // whether the row went back to the employee or to the manager.
  const reject = (list, reason, notify) => run(
    list,
    (e) => api.post(`/entries/${e._id}/reject`, { reason, notify }),
    (n, all) => (n === 1
      ? `ไม่อนุมัติรายการของ ${all[0].employee?.name} · บันทึกเหตุผลแล้ว`
      : `ไม่อนุมัติ ${n} รายการ · บันทึกเหตุผลไว้ในทุกรายการแล้ว`),
  );

  const override = (entry, reason) => run(
    [entry],
    (e) => api.post(`/entries/${e._id}/cap-override`, { reason }),
    () => 'บันทึกการอนุมัติเกินเพดานแล้ว',
  );

  /**
   * ถอนใบวันเกิด — the only action available on a row the reviewer filed
   * themselves, and it is here because this is where they are stuck.
   *
   * It goes through `/cancel`, the same endpoint an employee withdraws their own
   * request with; `cancelPermission` decides which of the two acts it is and the
   * history records `void` rather than `cancel`. The row leaves this queue, its
   * hours are counted nowhere, and the birthday goes back onto
   * วันเกิดที่ยังไม่มีใบ on ตรวจสอบรายเดือน — where the หัวหน้า's name is, which
   * is the path that was meant to file it.
   */
  const voidEntry = (entry) => run(
    [entry],
    (e) => api.post(`/entries/${e._id}/cancel`, { note: 'ถอนใบวันเกิดที่ระบบสร้าง' }),
    (n, all) => `ถอนใบวันเกิดของ ${all[0].employee?.name} แล้ว — ชั่วโมงนี้ไม่ถูกนับที่ใด`,
  );

  /** A row rewritten from inside the pop-up: refresh the table under it, and
      keep the pop-up itself showing the version that was just saved. */
  async function afterEntryChange(updated, message) {
    setDetail(updated);
    await load();
    if (message) toast(message);
  }

  // ── render ────────────────────────────────────────────────────────────────

  // The manager's own screen doubles as the way into filing for somebody who
  // cannot — it is where they already are when they notice the gap.
  if (filing) {
    return (
      <OtForm
        mode="proxy"
        onSaved={() => { setFiling(false); load(); onChanged?.(stage, 0); }}
        onCancel={() => setFiling(false)}
      />
    );
  }

  return (
    <div className="card flush">
      <div className="card-head">
        <div>
          <div className="t">
            {delegatedOnly ? 'รออนุมัติ · ทีมที่รับช่วง'
              : isHr ? 'รอ HR ยืนยัน' : 'รอหัวหน้าอนุมัติ'}
          </div>
          <div className="hint" style={{ margin: '3px 0 0' }}>
            {delegatedOnly
              ? 'คิวของหัวหน้างานที่คุณรับช่วงมา · การอนุมัติจะบันทึกว่าทำแทนเจ้าของคิว'
              : isHr
                ? 'ตรวจสอบรายเดือน · รายการที่ยืนยันแล้วจะเข้าสู่รายงานส่งออก'
                : `ตรวจสอบรายวัน · เฉพาะแผนก${user.department?.name || ''}`}
          </div>
        </div>
        {!isHr && !delegatedOnly && user.role === 'manager' && (
          <button className="btn ghost sm" onClick={() => setFiling(true)}>
            + บันทึก OT แทนลูกทีม
          </button>
        )}
        {entries?.length > 0 && (
          <span className="chip muted">
            {filtered ? `${shown.length} / ${entries.length}` : entries.length} รายการ
          </span>
        )}
      </div>

      {/*
        Standing in for somebody, said once at the top with the dates on it.
        A stand-in whose window shut yesterday and a stand-in who never had one
        both see the same queue — their own — and the only difference is what
        is missing from it, which is not something anybody notices. Naming the
        window while it is open is what makes its closing legible.
      */}
      {holding.length > 0 && (
        <div style={{ padding: '0 18px' }}>
          <Alert kind="info">
            <strong>คุณกำลังรับช่วงอนุมัติแทน</strong>{' '}
            {holding.map((d) => `${d.from?.name} (ถึง ${thaiDate(d.toDate)})`).join(' · ')}
            {' '}— คิวด้านล่างรวมทีมที่รับช่วงมาแล้ว {coveredCount} รายการ
            {' '}และแถวเหล่านั้นมีป้าย “รับช่วง” กำกับไว้
            <div style={{ fontSize: 12.5, marginTop: 4 }}>
              การอนุมัติของคุณจะถูกบันทึกว่า <strong>“ทำแทน”</strong> ชื่อหัวหน้าเจ้าของคิว
              {' '}ทั้งในประวัติรายการและบนใบพิมพ์ ·
              {' '}หัวหน้าเจ้าของคิวยังอนุมัติเองได้ตลอดเวลา
            </div>
          </Alert>
        </div>
      )}

      {/* Directly under the heading and above the filters, in the same gutter
          the error alert below uses — it is about the rules every figure in
          this queue was computed under, so it is read before the rows and not
          alongside one of them. Renders nothing unless the rules have drifted. */}
      <div style={{ padding: '0 18px' }}>
        <PolicyDriftBanner user={user} onOpenPolicy={onOpenPolicy} />
      </div>

      {/* ── filter bar ─────────────────────────────────────────────────────── */}
      {entries?.length > 0 && (
        <div className="queue-tools">
          <div className="field search">
            <label>ค้นหา</label>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ชื่อพนักงาน · รหัสพนักงาน · รายละเอียดงาน"
            />
          </div>
          {isHr && (
            <div className="field">
              <label>แผนก</label>
              <select value={dept} onChange={(e) => setDept(e.target.value)}>
                <option value="">ทุกแผนก</option>
                {departments.map((d) => (
                  <option key={d.value} value={d.value}>{d.label} ({d.count})</option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>เดือน</label>
            <select value={per} onChange={(e) => setPer(e.target.value)}>
              <option value="">ทุกเดือน</option>
              {periods.map((p) => (
                <option key={p.value} value={p.value}>{p.label} ({p.count})</option>
              ))}
            </select>
          </div>
          {(q || dept || per) && (
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => { setQ(''); setDept(''); setPer(''); }}
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
      )}

      {/* ── batch bar ──────────────────────────────────────────────────────── */}
      {picked.length > 0 && (
        <div className="batch-bar">
          <div className="count-label">
            เลือกไว้ <strong>{picked.length}</strong> รายการ
            <span className="sub">รวม {hours(pickedHours)} ชม.</span>
          </div>
          <button className="btn sm" disabled={busy} onClick={() => setConfirming(picked)}>
            ✓ {verb}รายการที่เลือก
          </button>
          <button
            className="btn ghost danger sm"
            disabled={busy}
            onClick={() => setRejecting(picked)}
          >
            ✕ ไม่อนุมัติรายการที่เลือก
          </button>
          <button className="link" disabled={busy} onClick={() => setSelected(new Set())}>
            ยกเลิกการเลือก
          </button>
        </div>
      )}

      {progress && (
        <div className="batch-progress">
          <div className="bar"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
          <span>กำลังดำเนินการ {progress.done} / {progress.total}</span>
        </div>
      )}

      {error && <div style={{ padding: '0 18px' }}><Alert kind="error">{error}</Alert></div>}

      {/* ── table ──────────────────────────────────────────────────────────── */}
      {!entries ? (
        <Empty>กำลังโหลด…</Empty>
      ) : entries.length === 0 ? (
        <QueueCleared cleared={everHadRows.current} isHr={isHr} />
      ) : shown.length === 0 ? (
        <Empty>ไม่มีรายการที่ตรงกับตัวกรอง</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="check">
                  <input
                    ref={allRef}
                    type="checkbox"
                    checked={actionable.length > 0 && selected.size === actionable.length}
                    onChange={toggleAll}
                    aria-label="เลือกทั้งหมด"
                  />
                </th>
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
              {shown.map((e) => (
                <tr key={e._id} className={selected.has(e._id) ? 'picked' : ''}>
                  <td className="check">
                    {/* Not tickable when this reviewer cannot decide it: a batch
                        of three that fails on one row is three presses to work
                        out which. `actionable` also keeps เลือกทั้งหมด off it. */}
                    <input
                      type="checkbox"
                      checked={selected.has(e._id)}
                      disabled={isOwnFiling(e, user)}
                      onChange={() => toggle(e._id)}
                      aria-label={`เลือกรายการของ ${e.employee?.name}`}
                    />
                  </td>
                  <td>
                    {e.employee?.name}
                    <div className="cell-sub">
                      {e.employee?.code} · {e.department?.nameTh || e.department?.name}
                    </div>
                  </td>
                  <td>
                    {thaiDate(e.workDate)}
                    <div className="cell-sub">วัน{dayName(e.workDate)}</div>
                  </td>
                  <td>
                    {e.startTime}–{e.endTime}
                    {e.endsNextDay && <div className="cell-note">ข้ามคืน</div>}
                    {e.noBreakTaken && <div className="cell-sub">ไม่พักเที่ยง</div>}
                  </td>
                  <td className="num">{hours(e.buckets?.[BUCKETS.OT15_WEEKDAY])}</td>
                  <td className="num">{hours(e.buckets?.[BUCKETS.OT15_HOLIDAY])}</td>
                  <td className="num">{hours(e.buckets?.[BUCKETS.OT3_HOLIDAY])}</td>
                  <td className="num"><strong>{hours(e.totals?.otHours)}</strong></td>
                  <td style={{ maxWidth: 240 }}>
                    {e.description}
                    {/* Whose team this row is from, when the reviewer is
                        holding more than one. */}
                    {covered.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <TeamMark entry={e} coveredDepartments={covered} />
                      </div>
                    )}
                    {/* Somebody else filled this in. It matters here because
                        the หัวหน้า who did is usually the person who would
                        otherwise be signing it — which is why it is on this
                        queue at all rather than theirs. */}
                    <ProxyMark entry={e} />
                    {/* The row above is the request as it stands now. This
                        says it has not always said that — the values being
                        approved are a revision. */}
                    {editsOf(e).length > 0 && (
                      <div style={{ marginTop: 4 }}><EditedMark entry={e} /></div>
                    )}
                    {/* Spotted before the row is opened: this one has been
                        refused once already, under a different date. */}
                    {e.refiledFrom && (
                      <div style={{ marginTop: 4 }}>
                        <span className="chip refiled">ส่งใหม่จากที่ไม่อนุมัติ</span>
                      </div>
                    )}
                    {/* Every ceiling breached, not the first — an entry can be
                        over the week and the month at once, and the reviewer
                        needs both to know what moving the shift would fix. */}
                    {describeBreaches(e).map((b) => (
                      <div className="cell-note" key={b.scope + b.text}>⚠ {b.text}</div>
                    ))}
                    {e.warnings?.map((w) => (
                      <div key={w.code} className="cell-sub">{w.message}</div>
                    ))}
                  </td>
                  <td>
                    {/* A row this reviewer wrote themselves cannot be signed OR
                        refused by them — one rule governs both, so offering
                        either button is offering a 403. What goes here instead is
                        the reason and, when the row is one the system generated
                        and nobody has touched, the only action that does work.
                        See `isOwnFiling` in lib/delegation.js. */}
                    {isOwnFiling(e, user) ? (
                      <div className="row-actions">
                        <span className="cell-sub" style={{ maxWidth: 190 }}>
                          คุณเป็นผู้บันทึกรายการนี้ จึงอนุมัติหรือไม่อนุมัติเองไม่ได้
                          {isUntouchedSystemFiling(e)
                            ? ' — ถอนใบได้ หรือให้ผู้ดูแลระบบยืนยันแทน'
                            : ' — ต้องให้คนอื่นเป็นผู้อนุมัติ'}
                        </span>
                        {isUntouchedSystemFiling(e) && (
                          <button
                            className="btn ghost sm"
                            disabled={busy}
                            onClick={() => voidEntry(e)}
                            title="ถอนใบที่ระบบสร้าง — ชั่วโมงนี้จะไม่ถูกนับที่ใด และหัวหน้าแผนกยังบันทึกแทนใหม่ได้"
                          >
                            ถอนใบวันเกิด
                          </button>
                        )}
                        <button className="btn ghost sm" onClick={() => setDetail(e)}>
                          รายละเอียด
                        </button>
                      </div>
                    ) : (
                      <div className="row-actions">
                        <button className="btn sm" disabled={busy} onClick={() => setConfirming([e])}>
                          {verb}
                        </button>
                        <button
                          className="btn ghost danger sm"
                          disabled={busy}
                          onClick={() => setRejecting([e])}
                        >
                          ไม่อนุมัติ
                        </button>
                        <button className="btn ghost sm" onClick={() => setDetail(e)}>
                          รายละเอียด
                        </button>
                        {isHr && e.capExceeded && (
                          <button
                            className="btn ghost warn sm"
                            disabled={busy}
                            onClick={() => setOverriding(e)}
                          >
                            อนุมัติเกินเพดาน
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {confirming && (
        <ConfirmModal
          entries={confirming}
          verb={verb}
          isHr={isHr}
          busy={busy}
          onClose={() => setConfirming(null)}
          onConfirm={() => { const list = confirming; setConfirming(null); approve(list); }}
        />
      )}

      {rejecting && (
        <RejectModal
          entries={rejecting}
          busy={busy}
          onClose={() => setRejecting(null)}
          onReject={(reason, notify) => {
            const list = rejecting;
            setRejecting(null);
            reject(list, reason, notify);
          }}
        />
      )}

      {overriding && (
        <OverrideModal
          entry={overriding}
          busy={busy}
          onClose={() => setOverriding(null)}
          onSave={(reason) => { const e = overriding; setOverriding(null); override(e, reason); }}
        />
      )}

      {detail && (
        <DetailModal
          entry={detail}
          verb={verb}
          busy={busy}
          mine={isOwnFiling(detail, user)}
          onClose={() => setDetail(null)}
          onApprove={() => { const e = detail; setDetail(null); approve([e]); }}
          onReject={(reason, notify) => { const e = detail; setDetail(null); reject([e], reason, notify); }}
          onEntryChanged={afterEntryChange}
        />
      )}
    </div>
  );
}

// ── batch modals ────────────────────────────────────────────────────────────

/**
 * ยืนยัน is one click away from payroll, so it gets a stop — but a short one.
 * A batch shows what it is about to move; a single row shows the row.
 */
function ConfirmModal({ entries, verb, isHr, busy, onClose, onConfirm }) {
  const total = entries.reduce((n, e) => n + (e.totals?.otHours || 0), 0);
  const capped = entries.filter((e) => e.capExceeded);
  const many = entries.length > 1;

  return (
    <Modal
      title={`${verb} ${entries.length} รายการ`}
      subtitle={isHr ? 'รายการที่ยืนยันแล้วจะเข้าสู่รายงานส่งออกทันที' : 'ส่งต่อให้ฝ่ายบุคคลยืนยัน'}
      onClose={onClose}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button className="btn" disabled={busy} onClick={onConfirm}>{verb}ทั้งหมด</button>
        </>
      )}
    >
      <div className="split">
        <div className="box">
          <div className="k">จำนวนรายการ</div>
          <div className="v">{entries.length}</div>
        </div>
        <div className="box" style={{ background: 'var(--green-bg)', borderColor: '#C4E3D2' }}>
          <div className="k">รวมชั่วโมง OT</div>
          <div className="v">{hours(total)}</div>
        </div>
      </div>

      {/* A cap breach that was fine to see on a row is not fine to lose inside
          a batch of forty. It gets said again, here, with the names attached. */}
      {capped.length > 0 && (
        <Alert kind="warn">
          {capped.length} รายการเกินเพดานแผนก — {capped.map((e) => e.employee?.name).join(', ')} ·
          {' '}ปิดหน้าต่างนี้แล้วใช้ “อนุมัติเกินเพดาน” หากตั้งใจให้ผ่าน
        </Alert>
      )}

      <EntryPeek entries={entries} collapsed={many} />
    </Modal>
  );
}

/** ไม่อนุมัติ from the table or the batch bar. The in-pop-up path uses the same
    fields without a second dialog — see RejectFields. */
function RejectModal({ entries, busy, onClose, onReject }) {
  const [state, setState] = useState({ reason: '', notify: { employee: true, manager: false } });
  const many = entries.length > 1;

  return (
    <Modal
      title={many ? `ไม่อนุมัติ ${entries.length} รายการ` : 'ไม่อนุมัติรายการนี้'}
      subtitle={many ? 'เหตุผลเดียวกันนี้จะถูกบันทึกในทุกรายการที่เลือก' : undefined}
      onClose={onClose}
      dirty={state.reason.trim().length > 0}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button
            className="btn danger"
            disabled={busy || !state.reason.trim()}
            onClick={() => onReject(state.reason.trim(), state.notify)}
          >
            ยืนยันไม่อนุมัติ
          </button>
        </>
      )}
    >
      <RejectFields value={state} onChange={setState} many={many} />
      <EntryPeek entries={entries} collapsed={many} />
    </Modal>
  );
}

/** §7 — waiving the department cap for one entry, with the reason on record. */
function OverrideModal({ entry, busy, onClose, onSave }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      title="อนุมัติเกินเพดานแผนก"
      subtitle={`${entry.employee?.name} · ${thaiDate(entry.workDate)}`}
      onClose={onClose}
      dirty={reason.trim().length > 0}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button className="btn" disabled={busy || !reason.trim()} onClick={() => onSave(reason.trim())}>
            บันทึกการอนุมัติ
          </button>
        </>
      )}
    >
      {/* One waiver covers the entry, but it has to name everything being
          waived — approving past a weekly ceiling while believing it was the
          monthly one is a decision made on the wrong facts. */}
      <Alert kind="warn">
        {describeBreaches(entry).map((b) => (
          <div key={b.scope + b.text}>
            {b.text}{b.detail ? ` · ${b.detail}` : ''}
          </div>
        ))}
      </Alert>
      <div className="field">
        <label>เหตุผลในการอนุมัติเกินเพดาน *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </div>
    </Modal>
  );
}

/** The reason and the notification choice, shared by the batch dialog and the
    in-pop-up refusal so the two cannot drift apart. */
function RejectFields({ value, onChange, many }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <>
      <div className="field">
        <label>เหตุผลที่ไม่อนุมัติ *</label>
        <textarea
          value={value.reason}
          onChange={(e) => set({ reason: e.target.value })}
          placeholder="เช่น เวลาที่ขอไม่ตรงกับเวลาสแกนนิ้ว · รายละเอียดงานไม่ชัดเจน"
          autoFocus
        />
        <div className={`field-note${value.reason.trim() ? '' : ' error'}`}>
          {value.reason.trim()
            ? `พนักงานจะเห็นข้อความนี้และยื่นใหม่ได้${many ? ' · ใช้กับทุกรายการที่เลือก' : ''}`
            : 'ต้องกรอกเหตุผลก่อนจึงจะไม่อนุมัติได้'}
        </div>
      </div>

      <div>
        <div className="kicker-sm" style={{ marginBottom: 8 }}>แจ้งกลับไปยัง</div>
        <label className="check">
          <input
            type="checkbox"
            checked={value.notify.employee}
            onChange={(e) => set({ notify: { ...value.notify, employee: e.target.checked } })}
          />
          พนักงานผู้ยื่นคำขอ
        </label>
        <label className="check" style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={value.notify.manager}
            onChange={(e) => set({ notify: { ...value.notify, manager: e.target.checked } })}
          />
          หัวหน้างานผู้อนุมัติ
        </label>
        {/* The reason lands on the entry either way — that part is real. The
            push channel is not built yet, and a tick box that quietly does
            nothing is worse on this screen than one that says so. */}
        <Alert kind="info">
          เหตุผลจะปรากฏบนรายการในระบบเสมอ ·
          {' '}ยังไม่ได้เชื่อมต่อการแจ้งเตือนทางอีเมล/LINE — ตัวเลือกนี้จะมีผลเมื่อเปิดใช้งานระบบแจ้งเตือน
        </Alert>
      </div>
    </>
  );
}

// ── the detail pop-up ───────────────────────────────────────────────────────

/**
 * รายละเอียด — everything the row had no room for, in the order a reviewer
 * asks for it: what was requested, how the engine split it, what the clock
 * says, who approved it below, and what the request used to say.
 *
 * It is also where the decision gets made, including refusing: sending the
 * reviewer to a second dialog to type a reason takes away the times, the
 * history and the scan comparison at the exact moment they are being explained
 * in writing. The refusal happens here, over the top of the same header.
 */
function DetailModal({ entry: e, verb, busy, mine = false, onClose, onApprove, onReject, onEntryChanged }) {
  const [mode, setMode] = useState('view'); // 'view' | 'rejecting'
  const [rejectState, setRejectState] = useState({
    reason: '', notify: { employee: true, manager: false },
  });
  const [editing, setEditing] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [trail, setTrail] = useState(null);

  const filed = lastAction(e, 'submit');
  const mgr = lastAction(e, 'approve_mgr');

  /**
   * Only fetched when there is a chain to fetch. A request nobody re-filed is
   * its own whole story, and it is already loaded — asking the server to
   * confirm that on every pop-up would be a round trip per row.
   */
  // Keyed on the parent's id rather than the populated object: saving a quick
  // edit hands back a fresh entry whose refiledFrom is a new object with the
  // same contents, and identity alone would refetch the trail every time.
  const parentId = e.refiledFrom?._id || e.refiledFrom || null;
  useEffect(() => {
    if (!parentId) { setTrail(null); return undefined; }
    let live = true;
    api.get(`/entries/${e._id}/trail`)
      .then((res) => { if (live) setTrail(res); })
      .catch(() => { if (live) setTrail(null); }); // the row's own history still shows
    return () => { live = false; };
  }, [e._id, parentId]);

  const footer = mode === 'rejecting' ? (
    <>
      <button className="btn ghost" onClick={() => setMode('view')}>ย้อนกลับ</button>
      <button
        className="btn danger"
        disabled={busy || !rejectState.reason.trim()}
        onClick={() => onReject(rejectState.reason.trim(), rejectState.notify)}
      >
        ยืนยันไม่อนุมัติ
      </button>
    </>
  ) : mine ? (
    // The reviewer filed this one. Neither decision is theirs to make, so the
    // pop-up closes and says why rather than repeating the row's two dead
    // buttons — the way out is on the row itself (ถอนใบวันเกิด) or another
    // reviewer.
    <button className="btn ghost" onClick={onClose}>ปิด</button>
  ) : (
    <>
      <button className="btn ghost" onClick={onClose}>ปิด</button>
      {/* Both decisions are shut while the hours are open for editing: a
          correction half-typed is not a basis for either one. */}
      <button className="btn ghost danger" disabled={busy || editing} onClick={() => setMode('rejecting')}>
        ไม่อนุมัติ
      </button>
      <button className="btn" disabled={busy || editing} onClick={onApprove}>{verb}</button>
    </>
  );

  return (
    <Modal
      wide
      title={e.employee?.name}
      subtitle={`${e.employee?.code} · ${e.department?.nameTh || e.department?.name} · ${thaiDate(e.workDate)} (วัน${dayName(e.workDate)})`}
      /* The number being decided about, kept out of the scroll area — it is
         the one thing that must not move while the body does, and the one
         Quick Edit changes. */
      meta={(
        <div className="head-meta">
          <div className="total">
            <span className="k">รวม</span>
            <span className="v">{hours(e.totals?.otHours)}</span>
            <span className="u">ชม.</span>
          </div>
          <StatusChip status={e.status} />
        </div>
      )}
      onClose={onClose}
      dirty={editDirty || (mode === 'rejecting' && rejectState.reason.trim().length > 0)}
      footer={footer}
    >
      {mode === 'rejecting' ? (
        <>
          <div className="box warn">
            กำลังไม่อนุมัติรายการนี้ — {e.startTime}–{e.endTime} · {hours(e.totals?.otHours)} ชม.
          </div>
          <RejectFields value={rejectState} onChange={setRejectState} many={false} />
        </>
      ) : (
        <>
          {/* Above the hours on purpose — see RefiledNote. */}
          <RefiledNote parent={e.refiledFrom} />

          {/* Same placement, same reason: a reviewer who finds out after
              forming a view that the request was written by the person who
              would normally have approved it has already formed the view. */}
          {isProxyFiled(e) && (
            <Alert kind="warn">
              {/* Who wrote it, in words that are true of them: a หัวหน้า filing
                  for their team, ฝ่ายบุคคล filing for somebody, or nobody at all
                  on a row the system generated. */}
              <strong>
                {isUntouchedSystemFiling(e) || isSystemFiled(e)
                  ? 'รายการนี้ระบบสร้างจากกฎวันหยุดวันเกิด ไม่มีใครกรอกแบบฟอร์ม'
                  : 'รายการนี้มีผู้อื่นเป็นผู้บันทึกแทนพนักงาน'}
              </strong>
              {e.filedBy?.name && <> — ผู้บันทึก: {e.filedBy.name}</>}
              {e.status === 'pending_hr' && !e.managerDecision?.at && (
                <> · รายการนี้<strong>ยังไม่ผ่านการอนุมัติจากหัวหน้า</strong>
                  {' '}เพราะผู้บันทึกคือผู้ที่จะอนุมัติเอง ระบบจึงข้ามขั้นนั้นมา
                </>
              )}
              {/* The sentence that was missing when this row could not be moved:
                  it names the rule and the two ways forward. */}
              {mine && (
                <div style={{ marginTop: 4 }}>
                  คุณเป็นผู้บันทึกรายการนี้เอง จึงอนุมัติหรือไม่อนุมัติเองไม่ได้ —
                  {isUntouchedSystemFiling(e)
                    ? ' กด “ถอนใบวันเกิด” ที่แถวในคิว หรือให้ผู้ดูแลระบบยืนยันแทน'
                    : ' ต้องให้ผู้อื่นเป็นผู้อนุมัติ'}
                </div>
              )}
            </Alert>
          )}

          <Section title="คำขอ">
            <dl className="fact-grid">
              <Fact k="เวลาที่ขอ" v={`${e.startTime}–${e.endTime}${e.endsNextDay ? ' (ข้ามคืน)' : ''}`} />
              <Fact k="พักเที่ยง" v={e.noBreakTaken ? 'ไม่พัก' : 'หักตามนโยบาย'} />
              <Fact k="ชั่วโมงตามนาฬิกา" v={`${hours(e.totals?.clockHours)} ชม.`} />
              <Fact
                k="เกินเพดานแผนก"
                v={e.capExceeded
                  ? describeBreaches(e).map((b) => b.text).join(' · ')
                  : 'ไม่'}
              />
            </dl>
            <div className="split" style={{ marginTop: 12 }}>
              {Object.values(BUCKETS).map((b) => (
                <div className="box" key={b}>
                  <div className="k">{BUCKET_LABEL[b]}</div>
                  <div className="v">{hours(e.buckets?.[b])}</div>
                </div>
              ))}
              <div className="box" style={{ background: 'var(--green-bg)', borderColor: '#C4E3D2' }}>
                <div className="k">รวม</div>
                <div className="v">{hours(e.totals?.otHours)}</div>
              </div>
            </div>
            <p className="note" style={{ marginTop: 10 }}>{e.description}</p>
          </Section>

          <Section
            title="การแบ่งช่วงเวลา"
            action={!editing && (
              <button className="btn ghost sm" onClick={() => setEditing(true)}>
                แก้ไขชั่วโมง
              </button>
            )}
          >
            {editing ? (
              <QuickEdit
                entry={e}
                onDirty={setEditDirty}
                onCancel={() => { setEditing(false); setEditDirty(false); }}
                onSaved={(updated) => {
                  setEditing(false);
                  setEditDirty(false);
                  onEntryChanged(updated, `แก้ไขชั่วโมงของ ${updated.employee?.name} แล้ว — ${hours(updated.totals?.otHours)} ชม.`);
                }}
              />
            ) : (
              <>
                <SegmentList segments={e.segments} />
                {e.warnings?.map((w) => <div key={w.code} className="hint">{w.message}</div>)}
              </>
            )}
          </Section>

          <Section title="ผู้อนุมัติ">
            <dl className="fact-grid">
              <Fact
                k="ยื่นคำขอโดย"
                v={filed?.byName || e.employee?.name}
                /* Named outright rather than left to the reader to work out
                   from two names that happen to differ. */
                sub={[
                  isProxyFiled(e) ? `บันทึกแทน ${e.employee?.name}` : null,
                  stamp(filed?.at),
                ].filter(Boolean).join(' · ') || undefined}
              />
              <Fact
                k="หัวหน้างานอนุมัติ"
                v={mgr?.byName || (e.status === 'pending_hr' && !e.managerDecision?.at
                  ? 'ข้ามขั้นหัวหน้า — ผู้บันทึกคือผู้อนุมัติเอง'
                  : 'ยังไม่ผ่านหัวหน้างาน')}
                /* Who signed, and whose authority they signed under. Left as
                   one name, a reviewer cannot tell an approval made by the
                   department's own หัวหน้า from one made by a stand-in — and
                   the second is the one with a window on it that either
                   covered the day or did not. */
                sub={[
                  mgr?.onBehalfOfName ? `ทำแทน ${mgr.onBehalfOfName}` : null,
                  mgr ? stamp(mgr.at) : undefined,
                ].filter(Boolean).join(' · ') || undefined}
              />
            </dl>
            {mgr?.note && <p className="note" style={{ marginTop: 8 }}>บันทึกจากหัวหน้างาน — {mgr.note}</p>}
          </Section>

          {/* One request's history, or the whole chain when this one replaced
              a refused request. The trail arrives a moment after the pop-up
              does, so until it lands this row's own history stands in rather
              than the section flickering empty. */}
          {trail?.requests?.length > 1 ? (
            <Section title="ประวัติรายการ (รวมคำขอเดิม)">
              <RequestTrail requests={trail.requests} liveStatus={e.status} />
              {trail.truncated && (
                <div className="hint">
                  แสดงย้อนหลังได้สูงสุด 20 คำขอ · อาจมีคำขอเก่ากว่านี้ที่ไม่ได้แสดง
                </div>
              )}
            </Section>
          ) : (e.history || []).length > 0 && (
            <Section title="ประวัติรายการ">
              <EntryHistory entry={e} />
            </Section>
          )}
        </>
      )}
    </Modal>
  );
}

// ── quick edit ──────────────────────────────────────────────────────────────

/**
 * แก้ไขชั่วโมง — the correction HR would otherwise have to refuse the request
 * to get.
 *
 * A scan that says the employee left at 20:15 against a request that says
 * 21:00 does not mean the request was dishonest; it means one field is wrong.
 * Rejecting it sends the whole thing back through the manager for a typo. This
 * fixes the field, keeps the approvals already collected, and leaves the old
 * values in the history where HR can see what they replaced.
 *
 * Saving does NOT confirm the entry. Correcting a number and vouching for it
 * are two decisions, and they get two presses.
 */
function QuickEdit({ entry, onDirty, onCancel, onSaved }) {
  const [form, setForm] = useState(() => ({
    startTime: entry.startTime,
    endTime: entry.endTime,
    endsNextDay: Boolean(entry.endsNextDay),
    noBreakTaken: Boolean(entry.noBreakTaken),
  }));
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const moved = form.startTime !== entry.startTime
    || form.endTime !== entry.endTime
    || form.endsNextDay !== Boolean(entry.endsNextDay)
    || form.noBreakTaken !== Boolean(entry.noBreakTaken);

  useEffect(() => { onDirty?.(moved || note.trim().length > 0); }, [moved, note]);

  // The engine decides what the hours are, not the form — so the form asks it,
  // and shows the answer before anything is written.
  useEffect(() => {
    if (!moved) { setPreview(null); setErr(''); return undefined; }
    const id = setTimeout(async () => {
      try {
        const res = await api.post('/entries/preview', {
          workDate: entry.workDate,
          ...form,
          employeeId: entry.employee?._id,
          entryId: entry._id, // keeps this entry's own hours out of the cap figure
        });
        setPreview(res);
        setErr('');
      } catch (e2) {
        setPreview(null);
        setErr(e2.message);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [form, moved]);

  async function save() {
    setSaving(true);
    try {
      const res = await api.patch(`/entries/${entry._id}`, { ...form, note: note.trim() });
      onSaved(res.entry);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setSaving(false);
    }
  }

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const nextHours = preview?.result?.totals?.otHours;

  return (
    <div className="quick-edit">
      <div className="row">
        <div className="field">
          <label>เวลาเริ่ม</label>
          <input type="time" value={form.startTime} onChange={(ev) => set({ startTime: ev.target.value })} />
        </div>
        <div className="field">
          <label>เวลาสิ้นสุด</label>
          <input type="time" value={form.endTime} onChange={(ev) => set({ endTime: ev.target.value })} />
        </div>
      </div>

      <div className="checks">
        <label className="check">
          <input
            type="checkbox"
            checked={form.endsNextDay}
            onChange={(ev) => set({ endsNextDay: ev.target.checked })}
          />
          ข้ามคืน
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={form.noBreakTaken}
            onChange={(ev) => set({ noBreakTaken: ev.target.checked })}
          />
          ไม่พักเที่ยง
        </label>
      </div>

      {moved && (
        <div className="edit-preview">
          <div className="kicker-sm">ผลหลังแก้ไข</div>
          {preview ? (
            <>
              <div className="delta">
                <span className="was">{hours(entry.totals?.otHours)} ชม.</span>
                <span className="to">→</span>
                <span className="now">{hours(nextHours)} ชม.</span>
              </div>
              <SegmentList segments={preview.result?.segments} />
              {preview.result?.warnings?.map((w) => (
                <div key={w.code} className="hint">{w.message}</div>
              ))}
              {preview.cap?.exceeded && (
                <Alert kind="warn">
                  แก้แล้วเกินเพดานแผนก {preview.cap.capHours} ชม./เดือน
                  {' '}(ใช้ไปแล้ว {hours(preview.cap.usedHoursBefore)} ชม.)
                </Alert>
              )}
            </>
          ) : !err && <div className="hint">กำลังคำนวณ…</div>}
        </div>
      )}

      <div className="field">
        <label>เหตุผลการแก้ไข *</label>
        <textarea
          value={note}
          onChange={(ev) => setNote(ev.target.value)}
          placeholder="เช่น ปรับตามเวลาสแกนออกจริง 20:15"
        />
        {/* Not a house rule — the server refuses an HR edit without one, so the
            button stays shut rather than letting the save fail. */}
        <div className={`field-note${note.trim() ? '' : ' error'}`}>
          {note.trim() ? 'บันทึกไว้ในประวัติรายการ พร้อมค่าเดิมก่อนแก้' : 'ต้องระบุเหตุผลก่อนบันทึก'}
        </div>
      </div>

      {err && <Alert kind="error">{err}</Alert>}

      <div className="quick-edit-foot">
        <button className="btn ghost" onClick={onCancel} disabled={saving}>ยกเลิก</button>
        <button className="btn" onClick={save} disabled={saving || !moved || !note.trim()}>
          {saving ? 'กำลังบันทึก…' : 'บันทึกชั่วโมงใหม่'}
        </button>
      </div>
      <div className="hint">
        การแก้ไขจะคำนวณชั่วโมงใหม่ทันทีและคงสถานะการอนุมัติเดิมไว้ · ยังต้องกด “{'ยืนยัน'}” อีกครั้งเพื่อรับรองรายการ
      </div>
    </div>
  );
}

// ── small parts ─────────────────────────────────────────────────────────────
function Section({ title, action, children }) {
  return (
    <section className="detail-sec">
      <div className="sec-head">
        <div className="kicker-sm">{title}</div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Fact({ k, v, sub }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}{sub && <div className="cell-sub">{sub}</div>}</dd>
    </div>
  );
}

/** The rows a confirmation is about — folded away when there are many. */
function EntryPeek({ entries, collapsed }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div>
      {collapsed && (
        <button type="button" className="link" onClick={() => setOpen(!open)}>
          {open ? 'ซ่อนรายการ' : `ดูรายการทั้ง ${entries.length} รายการ`}
        </button>
      )}
      {open && (
        <ul className="peek-list">
          {entries.map((e) => (
            <li key={e._id}>
              <span className="who">{e.employee?.name}</span>
              <span className="when">{thaiDate(e.workDate)} · {e.startTime}–{e.endTime}</span>
              <span className="num">{hours(e.totals?.otHours)} ชม.</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * An empty queue is two different facts. "Nothing arrived" is the state of the
 * world; "you just finished" is the end of a task, and worth saying out loud —
 * it is the same moment the sidebar badge disappears.
 */
function QueueCleared({ cleared, isHr }) {
  if (!cleared) return <Empty>ไม่มีรายการค้างในคิวนี้</Empty>;
  return (
    <div className="empty cleared">
      <div className="tick">✓</div>
      <strong>เคลียร์คิวครบทุกรายการแล้ว</strong>
      <div className="hint" style={{ marginTop: 4 }}>
        {isHr
          ? 'รายการที่ยืนยันไปแล้วอยู่ในตรวจสอบรายเดือนและรายงานส่งออก'
          : 'รายการที่อนุมัติแล้วส่งต่อให้ฝ่ายบุคคลเรียบร้อย'}
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────

const haystack = (e) => [
  e.employee?.name, e.employee?.code, e.description,
  e.department?.nameTh, e.department?.name,
].filter(Boolean).join(' ').toLowerCase();

/** Distinct filter options, with how many rows each one would leave. */
function optionsBy(entries, pick) {
  const seen = new Map();
  for (const e of entries || []) {
    const [value, label] = pick(e);
    if (!value) continue;
    const key = String(value);
    const hit = seen.get(key);
    if (hit) hit.count += 1;
    else seen.set(key, { value: key, label: label || key, count: 1 });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'th'));
}

/** The most recent time `action` was taken on the entry. */
function lastAction(entry, action) {
  const items = entry?.history || [];
  for (let i = items.length - 1; i >= 0; i--) if (items[i].action === action) return items[i];
  return null;
}

const stamp = (at) => (at ? new Date(at).toLocaleString('th-TH') : undefined);
