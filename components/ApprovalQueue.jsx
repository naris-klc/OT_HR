'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  api, hours, thaiDate, dayName, periodLabel, BUCKETS, BUCKET_LABEL,
} from '@/lib/api.js';
import {
  Alert, Empty, EditedMark, EntryHistory, Modal, SegmentList, StatusChip, editsOf,
} from './common.jsx';

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
export default function ApprovalQueue({ user, stage, onChanged }) {
  const isHr = stage === 'pending_hr';
  const verb = isHr ? 'ยืนยัน' : 'อนุมัติ';

  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total } during a batch

  // ── filters ───────────────────────────────────────────────────────────────
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [per, setPer] = useState('');

  // ── selection ─────────────────────────────────────────────────────────────
  const [selected, setSelected] = useState(() => new Set());
  const allRef = useRef(null);

  // ── modals ────────────────────────────────────────────────────────────────
  const [confirming, setConfirming] = useState(null); // entry[]
  const [rejecting, setRejecting] = useState(null);   // entry[]
  const [overriding, setOverriding] = useState(null); // entry
  const [detail, setDetail] = useState(null);         // entry

  /** Was there ever something in this queue this session? Drives the two
      different empty states — "nothing came in" vs "you just cleared it". */
  const everHadRows = useRef(false);

  async function load() {
    try {
      const res = await api.get(`/entries?status=${stage}`);
      setEntries(res.entries);
      if (res.entries.length) everHadRows.current = true;
    } catch (err) { setError(err.message); }
  }

  useEffect(() => {
    setEntries(null);
    setSelected(new Set());
    everHadRows.current = false;
    load();
  }, [stage]);

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

  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = selected.size > 0 && selected.size < shown.length;
    }
  }, [selected, shown]);

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
    selected.size === shown.length ? new Set() : new Set(shown.map((e) => e._id)),
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
    setFlash('');
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
    onChanged?.();
    setBusy(false);
    if (failed.length) setError(`ทำรายการไม่สำเร็จ ${failed.length} รายการ · ${failed.join(' · ')}`);
    else setFlash(done(list.length));
  }

  const approve = (list) => run(
    list,
    (e) => api.post(`/entries/${e._id}/approve`),
    (n) => `${verb}แล้ว ${n} รายการ${isHr ? ' — เข้าสู่รายงานส่งออกแล้ว' : ''}`,
  );

  // The landing status is a policy flag (hrRejectReturnsTo), so the message
  // says what is certain — the reason is on the record — rather than guessing
  // whether the row went back to the employee or to the manager.
  const reject = (list, reason, notify) => run(
    list,
    (e) => api.post(`/entries/${e._id}/reject`, { reason, notify }),
    (n) => `ไม่อนุมัติ ${n} รายการ · บันทึกเหตุผลไว้ในรายการแล้ว`,
  );

  const override = (entry, reason) => run(
    [entry],
    (e) => api.post(`/entries/${e._id}/cap-override`, { reason }),
    () => 'บันทึกการอนุมัติเกินเพดานแล้ว',
  );

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="card flush">
      <div className="card-head">
        <div>
          <div className="t">{isHr ? 'รอ HR ยืนยัน' : 'รอหัวหน้าอนุมัติ'}</div>
          <div className="hint" style={{ margin: '3px 0 0' }}>
            {isHr
              ? 'ตรวจสอบรายเดือน · รายการที่ยืนยันแล้วจะเข้าสู่รายงานส่งออก'
              : `ตรวจสอบรายวัน · เฉพาะแผนก${user.department?.name || ''}`}
          </div>
        </div>
        {entries?.length > 0 && (
          <span className="chip muted">
            {filtered ? `${shown.length} / ${entries.length}` : entries.length} รายการ
          </span>
        )}
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
            <label>งวดเดือน</label>
            <select value={per} onChange={(e) => setPer(e.target.value)}>
              <option value="">ทุกงวด</option>
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

      <div style={{ padding: '0 18px' }}>
        {error && <Alert kind="error">{error}</Alert>}
        {flash && <Alert kind="ok">{flash}</Alert>}
      </div>

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
                    checked={shown.length > 0 && selected.size === shown.length}
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
                    <input
                      type="checkbox"
                      checked={selected.has(e._id)}
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
                    {/* The row above is the request as it stands now. This
                        says it has not always said that — the values being
                        approved are a revision. */}
                    {editsOf(e).length > 0 && (
                      <div style={{ marginTop: 4 }}><EditedMark entry={e} /></div>
                    )}
                    {e.capExceeded && (
                      <div className="cell-note">
                        ⚠ เกินเพดานแผนก ({e.capSnapshot?.capHours} ชม.)
                      </div>
                    )}
                    {e.warnings?.map((w) => (
                      <div key={w.code} className="cell-sub">{w.message}</div>
                    ))}
                  </td>
                  <td>
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
          onClose={() => setDetail(null)}
          onApprove={() => { const e = detail; setDetail(null); setConfirming([e]); }}
          onReject={() => { const e = detail; setDetail(null); setRejecting([e]); }}
        />
      )}
    </div>
  );
}

// ── modals ──────────────────────────────────────────────────────────────────

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

/** ไม่อนุมัติ — the reason is required, because the employee reads it. */
function RejectModal({ entries, busy, onClose, onReject }) {
  const [reason, setReason] = useState('');
  const [toEmployee, setToEmployee] = useState(true);
  const [toManager, setToManager] = useState(false);
  const many = entries.length > 1;

  return (
    <Modal
      title={many ? `ไม่อนุมัติ ${entries.length} รายการ` : 'ไม่อนุมัติรายการนี้'}
      subtitle={many ? 'เหตุผลเดียวกันนี้จะถูกบันทึกในทุกรายการที่เลือก' : undefined}
      onClose={onClose}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button
            className="btn danger"
            disabled={busy || !reason.trim()}
            onClick={() => onReject(reason.trim(), { employee: toEmployee, manager: toManager })}
          >
            ยืนยันไม่อนุมัติ
          </button>
        </>
      )}
    >
      <div className="field">
        <label>เหตุผลที่ไม่อนุมัติ *</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="เช่น เวลาที่ขอไม่ตรงกับเวลาสแกนนิ้ว · รายละเอียดงานไม่ชัดเจน"
          autoFocus
        />
        <div className={`field-note${reason.trim() ? '' : ' error'}`}>
          {reason.trim() ? 'พนักงานจะเห็นข้อความนี้และยื่นใหม่ได้' : 'ต้องกรอกเหตุผลก่อนจึงจะไม่อนุมัติได้'}
        </div>
      </div>

      <div>
        <div className="kicker-sm" style={{ marginBottom: 8 }}>แจ้งกลับไปยัง</div>
        <label className="check">
          <input type="checkbox" checked={toEmployee} onChange={(e) => setToEmployee(e.target.checked)} />
          พนักงานผู้ยื่นคำขอ
        </label>
        <label className="check" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={toManager} onChange={(e) => setToManager(e.target.checked)} />
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
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ยกเลิก</button>
          <button className="btn" disabled={busy || !reason.trim()} onClick={() => onSave(reason.trim())}>
            บันทึกการอนุมัติ
          </button>
        </>
      )}
    >
      <Alert kind="warn">
        เพดาน {entry.capSnapshot?.capHours} ชม./เดือน ·
        {' '}ใช้ไปแล้ว {hours(entry.capSnapshot?.usedHoursBefore)} ชม. ก่อนรายการนี้
      </Alert>
      <div className="field">
        <label>เหตุผลในการอนุมัติเกินเพดาน *</label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </div>
    </Modal>
  );
}

/**
 * รายละเอียด — everything the row had no room for, in the order a reviewer
 * asks for it: what was requested, how the engine split it, who approved it
 * below, what the clock says, and what the request used to say.
 */
function DetailModal({ entry: e, verb, busy, onClose, onApprove, onReject }) {
  const filed = lastAction(e, 'submit');
  const mgr = lastAction(e, 'approve_mgr');

  return (
    <Modal
      wide
      title={`${e.employee?.name} · ${thaiDate(e.workDate)}`}
      subtitle={`${e.employee?.code} · ${e.department?.nameTh || e.department?.name} · วัน${dayName(e.workDate)}`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn ghost" onClick={onClose}>ปิด</button>
          <button className="btn ghost danger" disabled={busy} onClick={onReject}>ไม่อนุมัติ</button>
          <button className="btn" disabled={busy} onClick={onApprove}>{verb}</button>
        </>
      )}
    >
      <Section title="คำขอ">
        <dl className="fact-grid">
          <Fact k="เวลาที่ขอ" v={`${e.startTime}–${e.endTime}${e.endsNextDay ? ' (ข้ามคืน)' : ''}`} />
          <Fact k="พักเที่ยง" v={e.noBreakTaken ? 'ไม่พัก' : 'หักตามนโยบาย'} />
          <Fact k="ชั่วโมงตามนาฬิกา" v={`${hours(e.totals?.clockHours)} ชม.`} />
          <Fact k="สถานะ" v={<StatusChip status={e.status} />} />
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

      <Section title="การแบ่งช่วงเวลา">
        <SegmentList segments={e.segments} />
        {e.warnings?.map((w) => <div key={w.code} className="hint">{w.message}</div>)}
      </Section>

      <Section title="เวลาสแกนนิ้วเทียบกับเวลาที่ขอ">
        <ClockCompare entry={e} />
      </Section>

      <Section title="ผู้อนุมัติ">
        <dl className="fact-grid">
          <Fact k="ยื่นคำขอโดย" v={filed?.byName || e.employee?.name} sub={stamp(filed?.at)} />
          <Fact
            k="หัวหน้างานอนุมัติ"
            v={mgr?.byName || 'ยังไม่ผ่านหัวหน้างาน'}
            sub={mgr ? stamp(mgr.at) : undefined}
          />
        </dl>
        {mgr?.note && <p className="note" style={{ marginTop: 8 }}>บันทึกจากหัวหน้างาน — {mgr.note}</p>}
      </Section>

      <Section title="เอกสารแนบ">
        <Attachments entry={e} />
      </Section>

      {(e.history || []).length > 0 && (
        <Section title="ประวัติรายการ">
          <EntryHistory entry={e} />
        </Section>
      )}
    </Modal>
  );
}

/**
 * The scan against the request.
 *
 * The entry model holds no attendance data — nothing in this system reads the
 * fingerprint terminal yet. Rather than draw an empty comparison that looks
 * broken, this says so, and lights up on its own the day an entry arrives
 * carrying `attendance: { clockIn, clockOut }`.
 */
function ClockCompare({ entry: e }) {
  const a = e.attendance;
  if (!a?.clockIn && !a?.clockOut) {
    return (
      <div className="box info">
        ยังไม่ได้เชื่อมต่อข้อมูลเครื่องสแกนนิ้วกับระบบนี้ ·
        {' '}ตรวจเทียบกับรายงานเวลาเข้า–ออกจากเครื่องบันทึกเวลาไปก่อน
      </div>
    );
  }
  return (
    <table className="mini">
      <thead>
        <tr><th /><th>เวลาที่ขอ OT</th><th>เวลาสแกนนิ้ว</th><th className="num">ต่าง</th></tr>
      </thead>
      <tbody>
        <ClockRow label="เข้า" asked={e.startTime} actual={a.clockIn} />
        <ClockRow label="ออก" asked={e.endTime} actual={a.clockOut} />
      </tbody>
    </table>
  );
}

function ClockRow({ label, asked, actual }) {
  const diff = minutesBetween(asked, actual);
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{asked || '—'}</td>
      <td className="num">{actual || '—'}</td>
      <td className="num" style={{ color: diff && Math.abs(diff) > 15 ? 'var(--danger-ink)' : 'inherit' }}>
        {diff == null ? '—' : `${diff > 0 ? '+' : ''}${diff} น.`}
      </td>
    </tr>
  );
}

/** Same contract as ClockCompare: renders whatever `attachments` the API sends. */
function Attachments({ entry: e }) {
  if (!e.attachments?.length) {
    return <div className="box">ไม่มีเอกสารแนบกับรายการนี้</div>;
  }
  return (
    <ul className="attach-list">
      {e.attachments.map((f) => (
        <li key={f.url || f.name}>
          <a className="link" href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
          {f.size != null && <span className="hint"> · {Math.round(f.size / 1024)} KB</span>}
        </li>
      ))}
    </ul>
  );
}

// ── small parts ─────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <section className="detail-sec">
      <div className="kicker-sm">{title}</div>
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

/** actual − asked, in minutes. Null unless both are 'HH:MM'. */
function minutesBetween(asked, actual) {
  const toMin = (t) => (/^\d{2}:\d{2}$/.test(t || '')
    ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
    : null);
  const a = toMin(asked);
  const b = toMin(actual);
  return a == null || b == null ? null : b - a;
}
