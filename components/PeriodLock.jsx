'use client';

import React, { useEffect, useState } from 'react';
import { api, periodLabel } from '@/lib/api.js';
import { closeRefusal, closeWarnings, previousMonthOpen, reopenRefusal } from '@/lib/periodLock.js';
import { previousPeriod } from '@/lib/reports.js';
import { Alert, Modal } from './common.jsx';

/**
 * Where this month stands, and the two buttons that change it.
 *
 * It lives on ตรวจสอบรายเดือน because that is the screen HR is on when a month
 * ends — they read the totals, print the sheets, export the file, and closing
 * the period is the last step of that sitting rather than an errand on a
 * settings page they would have to remember to visit.
 *
 * THE BUTTONS ARE DECIDED BY THE SAME FUNCTIONS THE SERVER REFUSES WITH.
 * `closeRefusal` and `reopenRefusal` are pure and live in lib/periodLock.js, so
 * this component asks them rather than re-deriving "HR may close, admin may
 * reopen, not while requests are pending" from roles and counts. A screen that
 * works that out for itself is a screen that will eventually offer a button the
 * server refuses — and the refusal it shows would be the first the user heard
 * of a rule the screen was supposed to explain.
 *
 * A refusal with status 403 hides the button: it means this is not this
 * person's job, and a permanently disabled control is noise on their screen.
 * Any other refusal disables it and prints why, because those are states the
 * person looking CAN do something about — clear the queue, or ask an
 * administrator.
 */
export default function PeriodLockBar({ user, period, onChanged = null }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [reopening, setReopening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('');

  /**
   * The month BEFORE this one, and whether anybody ever closed it.
   *
   * Closing is the last step of a sitting that starts on this screen, and this
   * bar has always said the right thing about the month it is looking at. What
   * nothing said is that the month before is still open — HR arrives on the
   * current month by default, sees a bar that correctly reports an open period
   * (you do not close the month you are in), and there is no screen anywhere
   * that mentions the one that ended.
   *
   * ONE MONTH BACK, not all of them. A sweep would be the thorough answer and
   * the wrong one: it needs an endpoint that does not exist, and a prompt
   * listing every unclosed month since the system was installed is a prompt
   * people learn to scroll past. Closing is monthly, so a miss is caught next
   * month — and if it is not, this line is still there the month after.
   *
   * `entries` is why closeChecks now counts them. A month nobody worked is
   * trivially closable and pointless to ask about, and every month before the
   * system existed is one of those.
   */
  const [previous, setPrevious] = useState(null);

  async function load() {
    try {
      setState(await api.get(`/periods/${period}`));
      setErr('');
    } catch (e) { setErr(e.message); }
    // Separately, and failure is silent: a reminder that cannot be fetched is
    // not a reason to break the bar that closes the month.
    try {
      setPrevious(await api.get(`/periods/${previousPeriod(period)}`));
    } catch { setPrevious(null); }
  }

  useEffect(() => { setState(null); setPrevious(null); load(); }, [period]);

  async function act(path, payload) {
    setBusy(true);
    try {
      setState({
        ...(await api.post(`/periods/${period}/${path}`, payload)),
        pending: state?.pending ?? 0,
        checks: state?.checks ?? null,
      });
      setErr('');
      setReopening(false);
      setClosing(false);
      setReason('');
      onChanged?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  // Nothing at all until the state is known: a bar that says "open" for half a
  // second on a closed month is worse than no bar.
  if (!state) return err ? <Alert kind="error">{err}</Alert> : null;

  const lastMonth = previousMonthOpen(previous);
  const lock = state.lock || null;
  const checks = state.checks || {};
  const closeBlock = closeRefusal({
    user,
    lock,
    pendingCount: state.pending,
    openWithdrawalCount: checks.openWithdrawals,
    period,
  });
  const reopenBlock = reopenRefusal({ user, lock, reason: 'x', period });
  // Not refusals — see closeWarnings. They are what the dialog exists to print.
  const warnings = closeWarnings({
    capExceededCount: checks.capExceeded,
    belowMinimumCount: checks.belowMinimum,
  });

  return (
    <div className={`card period-lock ${state.closed ? 'closed' : ''}`}>
      <div className="row" style={{ alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <strong>{state.closed ? '🔒 ' : ''}{state.text}</strong>
          {/* The reason a month was reopened belongs beside the fact that it
              was — it is the only part of that event nobody can reconstruct. */}
          {!state.closed && lock?.reopenReason && (
            <div className="hint" style={{ margin: '4px 0 0' }}>
              เหตุผล: {lock.reopenReason}
            </div>
          )}
          {state.closed && (
            <div className="hint" style={{ margin: '4px 0 0' }}>
              แก้ไข ยกเลิก อนุมัติ และบันทึกรายการย้อนหลังของงวดนี้ถูกปิดทั้งหมด
            </div>
          )}
          {/* Shown whatever THIS month's state is, including when it is closed:
              closing สิงหาคม while กรกฎาคม is still open is exactly the order
              in which a month gets skipped, and the moment it is most worth
              saying. Not an Alert — it is a fact about another month, not a
              problem with this one. */}
          {lastMonth && (
            <div className="hint" style={{ margin: '4px 0 0' }}>
              <strong>{periodLabel(previousPeriod(period))} ยังไม่ได้ปิดงวด</strong>
              {' '}— มี {lastMonth.entries} รายการในเดือนนั้น
              {lastMonth.pending > 0
                ? ` และยังค้างอนุมัติ ${lastMonth.pending} ใบ`
                : ' และไม่มีใบค้างอนุมัติแล้ว'}
              {' '}· เลือกเดือนนั้นด้านบนเพื่อปิด
            </div>
          )}
          {!state.closed && state.pending > 0 && (
            <div className="hint" style={{ margin: '4px 0 0' }}>
              ยังมีใบค้างอนุมัติ {state.pending} ใบ — ต้องเคลียร์ให้หมดก่อนจึงจะปิดงวดได้
            </div>
          )}
          {/* Said on the bar as well as in the dialog, because this one is a
              reason the button is disabled and the person looking at a greyed
              out ปิดงวด needs to know which screen to go to. The requests are
              not in the approval queue — the entries are approved. */}
          {!state.closed && checks.openWithdrawals > 0 && (
            <div className="hint" style={{ margin: '4px 0 0' }}>
              ยังมีคำขอถอนใบค้างพิจารณา {checks.openWithdrawals} คำขอ — ปิดงวดแล้วจะไม่มีใครตอบได้อีก
            </div>
          )}
        </div>

        {!state.closed && closeBlock?.status !== 403 && (
          <button
            className="btn"
            disabled={busy || Boolean(closeBlock)}
            title={closeBlock?.error || `ปิดงวด ${periodLabel(period)} — หลังจากนี้แก้ไขไม่ได้`}
            onClick={() => setClosing(true)}
          >
            ปิดงวด
          </button>
        )}

        {state.closed && reopenBlock?.status !== 403 && (
          <button
            className="btn ghost danger"
            disabled={busy}
            title="เปิดงวดที่ปิดแล้ว ต้องระบุเหตุผล และจะถูกบันทึกไว้"
            onClick={() => setReopening(true)}
          >
            เปิดงวด
          </button>
        )}
      </div>

      {err && <div style={{ marginTop: 10 }}><Alert kind="error">{err}</Alert></div>}

      {/* The events, oldest first — how this month came to be the way it is.
          Only shown once there is more than the first close to read. */}
      {lock?.events?.length > 1 && (
        <div className="hint" style={{ marginTop: 10 }}>
          {lock.events.map((ev, i) => (
            <div key={`${ev.at}-${i}`}>
              {ev.action === 'close' ? 'ปิดงวด' : 'เปิดงวด'} · {ev.byName || '—'}
              {ev.reason ? ` · ${ev.reason}` : ''}
            </div>
          ))}
        </div>
      )}

      {/**
        * ปิดงวด had no confirmation at all — one click, and every write path in
        * the month shut, undoable only by an administrator. เปิดงวด, the
        * reversible half of the pair, has had a dialog since it was written.
        *
        * This is that stop, and it is also where the health check is read. The
        * warnings could have gone on the bar, but a line above a button is a
        * line people stop seeing by the third month; a dialog they have to pass
        * through is read at least once, on the sitting that matters.
        */}
      {closing && (
        <Modal
          title={`ปิดงวด ${periodLabel(period)}`}
          subtitle="ตรวจสอบก่อนปิด — หลังจากนี้ทั้งเดือนแก้ไขไม่ได้"
          onClose={() => setClosing(false)}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setClosing(false)}>ยังไม่ปิด</button>
              <button className="btn" disabled={busy} onClick={() => act('close')}>
                ยืนยันปิดงวด
              </button>
            </>
          )}
        >
          <Alert kind="warn">
            หลังปิดงวด ทุกใบในเดือนนี้จะ<strong>แก้ไข ยกเลิก อนุมัติ และขอถอนไม่ได้ทั้งหมด</strong>
            {' '}เปิดใหม่ได้เฉพาะผู้ดูแลระบบ และต้องระบุเหตุผล
          </Alert>

          {warnings.length > 0 ? (
            <>
              <div style={{ font: '600 13.5px/1.6 var(--sans)', marginTop: 12 }}>
                รายการที่ควรดูก่อนปิด
              </div>
              <div className="hint" style={{ margin: '2px 0 0' }}>
                ทั้งหมดนี้<strong>ไม่ได้ขวางการปิดงวด</strong> — อนุมัติไปแล้วและถือว่าจบแล้ว
                {' '}แต่ปิดไปแล้วจะแก้ไม่ได้ จึงแสดงไว้ให้ตัดสินใจอีกครั้ง
              </div>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {warnings.map((w) => (
                  <li key={w.kind} style={{ font: '400 13.5px/1.7 var(--sans)' }}>{w.text}</li>
                ))}
              </ul>
            </>
          ) : (
            <div className="hint" style={{ marginTop: 12 }}>
              ตรวจแล้ว — ไม่มีใบค้างอนุมัติ ไม่มีคำขอถอนค้างพิจารณา
              และไม่มีใบที่ติดธงเพดานหรือเกณฑ์ขั้นต่ำในเดือนนี้
            </div>
          )}
        </Modal>
      )}

      {reopening && (
        <Modal
          title={`เปิดงวด ${periodLabel(period)}`}
          onClose={() => setReopening(false)}
          footer={(
            <>
              <button className="btn ghost" onClick={() => setReopening(false)}>ยกเลิก</button>
              <button
                className="btn danger"
                disabled={busy || !reason.trim()}
                onClick={() => act('reopen', { reason: reason.trim() })}
              >
                เปิดงวด
              </button>
            </>
          )}
        >
          <Alert kind="warn">
            งวดนี้ถูกปิดไปแล้ว และตัวเลขอาจถูกส่งให้บัญชีไปแล้ว
            {' '}การเปิดงวดทำให้ทุกใบในเดือนนี้แก้ไขได้อีกครั้ง
            <div style={{ marginTop: 4 }}>เมื่อแก้เสร็จแล้ว ให้ปิดงวดใหม่ทันที</div>
          </Alert>
          <div className="field" style={{ marginTop: 12 }}>
            <label>เหตุผลในการเปิดงวด *</label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น แก้ชั่วโมงใบของ PM-0412 ที่บันทึกผิดช่องอัตรา"
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
