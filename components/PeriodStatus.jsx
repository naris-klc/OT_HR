'use client';

import React, { useEffect, useState } from 'react';
import { api, periodLabel } from '@/lib/api.js';
import { previousMonthOutstanding } from '@/lib/periodStatus.js';
import { previousPeriod } from '@/lib/reports.js';
import { Alert } from './common.jsx';

/**
 * สรุปสถานะงวด — what is still unanswered in this month, and nothing else.
 *
 * IT HAS NO BUTTONS, AND THAT IS THE POINT. Until 2026-08-31 this card was
 * PeriodLockBar: it carried ปิดงวด and เปิดงวด, a confirmation dialog, a
 * reopen-with-a-reason dialog, and the event history behind them. HR withdrew
 * the feature — the printed, signed F-HR-027 in the filing cabinet is the
 * record, so a lock in the database bought nothing and turned every late
 * correction into an errand for an administrator. See lib/periodStatus.js.
 *
 * WHAT SURVIVED IS THE CHECK THE BUTTON USED TO BE PRECEDED BY. ฝ่ายบุคคล come
 * to ตรวจสอบรายเดือน at the end of a month to read the totals, print the sheets
 * and export the file. The question they had before pressing print — is anything
 * in this month still waiting for somebody? — is the same question, and it is
 * worth more than the lock was, because a request nobody has signed is simply
 * absent from the paper.
 *
 * IT IS A NOTICE, NOT A CONTROL, so it never disables or hides itself by role.
 * The old card decided what to draw from `closeRefusal` and `reopenRefusal`,
 * which meant a หัวหน้า saw a different card from ฝ่ายบุคคล. There is nothing to
 * be permitted here: everybody who can reach this screen reads the same counts.
 */
export default function PeriodStatus({ period }) {
  const [state, setState] = useState(null);
  const [previous, setPrevious] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    try {
      setState(await api.get(`/periods/${period}`));
      setErr('');
    } catch (e) { setErr(e.message); }
    /**
     * The month BEFORE this one, fetched separately, and failure is silent.
     *
     * ฝ่ายบุคคล arrive on the current month by default; the month that ENDED is
     * the one they are about to print, and no other line on this screen mentions
     * it. A reminder that cannot be fetched is not a reason to break the card
     * about the month they are actually looking at.
     */
    try {
      setPrevious(await api.get(`/periods/${previousPeriod(period)}`));
    } catch { setPrevious(null); }
  }

  useEffect(() => { setState(null); setPrevious(null); load(); }, [period]);

  // Nothing at all until the counts are known: a card that says "ไม่มีเอกสาร
  // ตกค้าง" for half a second on a month with four pending requests is worse
  // than no card.
  if (!state) return err ? <Alert kind="error">{err}</Alert> : null;

  const lastMonth = previousMonthOutstanding(previous);

  return (
    <div className={`card period-status ${state.clear ? 'clear' : 'outstanding'}`}>
      <div>
        <strong>{state.clear ? '✓ ' : '⚠ '}{state.headline}</strong>

        {/* `why` AND NOT `text`, because the headline directly above already
            carries the count. The first draft printed the whole sentence here
            and the card read "มีใบรออนุมัติค้างอยู่ 4 ใบ" twice, one line
            apart — which reads as a bug rather than as emphasis.

            Two outstanding things get their `short` back as a label, because
            then the headline holds two counts and two bare consequences under
            it would be a matching exercise. */}
        {state.outstanding.map((item) => (
          <div className="hint" key={item.kind} style={{ margin: '4px 0 0' }}>
            {state.outstanding.length > 1 ? `${item.short} — ${item.why}` : item.why}
          </div>
        ))}

        {/* Finished, and worth a second look before the sheet is signed — never
            in the headline, because neither of these holds up a printout, and
            always with its count, because nothing above them named it. */}
        {state.review.length > 0 && (
          <div className="hint" style={{ margin: '4px 0 0' }}>
            ควรตรวจก่อนพิมพ์ (ไม่ได้ค้างใคร):
            {state.review.map((item) => (
              <div key={item.kind}>· {item.text}</div>
            ))}
          </div>
        )}

        {/* Only when last month still has something unanswered in it. A quiet
            finished month is silent — see previousMonthOutstanding. */}
        {lastMonth && (
          <div className="hint" style={{ margin: '4px 0 0' }}>
            <strong>{periodLabel(previousPeriod(period))} ยังมีของค้างอยู่</strong>
            {' '}— {lastMonth.outstanding.map((i) => i.short).join(' และ ')}
            {' '}· เลือกเดือนนั้นด้านบนเพื่อตรวจก่อนพิมพ์
          </div>
        )}
      </div>

      {err && <div style={{ marginTop: 10 }}><Alert kind="error">{err}</Alert></div>}
    </div>
  );
}
